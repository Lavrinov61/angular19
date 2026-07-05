import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiResponse, PaginatedResponse } from '../../../core/services/api.service';

export type TaskListScope = 'assigned' | 'created' | 'all';
export type TaskViewerRelation = 'assignee' | 'creator' | 'assignee_creator';

export interface WorkTask {
  id: string;
  task_number: number;
  task_type: string;
  order_id?: string;
  print_order_id?: string;
  booking_id?: string;
  chat_session_id?: string;
  client_id?: string;
  assigned_to?: string;
  assigned_to_name?: string;
  assigned_studio_id?: string;
  studio_name?: string;
  location_code?: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'open' | 'assigned' | 'in_progress' | 'waiting' | 'handed_off' | 'completed' | 'cancelled';
  title: string;
  description?: string;
  client_name?: string;
  client_phone?: string;
  client_channel?: string;
  due_date?: string;
  ai_summary?: string;
  metadata?: Record<string, unknown>;
  created_by?: string;
  created_by_name?: string;
  viewer_relation?: TaskViewerRelation;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  notes?: TaskNote[];
  handoffs?: TaskHandoff[];
  chat_links?: ChatTaskLink[];
}

export interface UpdateWorkTaskRequest {
  title?: string;
  description?: string | null;
  priority?: WorkTask['priority'];
  due_date?: string | null;
  client_name?: string | null;
  client_phone?: string | null;
  client_channel?: string | null;
  assigned_studio_id?: string | null;
  metadata?: Record<string, unknown>;
}

export interface TaskNote {
  id: string;
  task_id: string;
  author_id: string;
  author_name?: string;
  note_type: 'comment' | 'status_change' | 'handoff' | 'system' | 'ai_summary';
  content: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface TaskHandoff {
  id: string;
  task_id: string;
  from_employee_id: string;
  from_name?: string;
  to_employee_id?: string;
  to_name?: string;
  handoff_note: string;
  ai_context_summary?: string;
  acknowledged: boolean;
  acknowledged_at?: string;
  acknowledged_by_name?: string;
  created_at: string;
}

export interface ChatTaskLink {
  id: string;
  task_id: string;
  chat_session_id?: string;
  bitrix_chat_id?: string;
  messenger_type?: string;
  visitor_name?: string;
  visitor_phone?: string;
  chat_channel?: string;
  chat_status?: string;
}

export interface TaskBoard {
  open: WorkTask[];
  assigned: WorkTask[];
  in_progress: WorkTask[];
  waiting: WorkTask[];
  handed_off: WorkTask[];
}

// ---- Client Context (cross-DB) ----

export interface ClientContext {
  profile: {
    name: string | null;
    phone: string | null;
    channels: string[];
    total_purchases: number;
    total_revenue: number;
    first_visit: string | null;
    unified_customer_id: number | null;
  };
  chat_history: ChatHistoryEntry[];
  orders: ClientOrder[];
  bookings: ClientBooking[];
  other_tasks: ClientTask[];
}

export interface ChatHistoryEntry {
  source: 'website' | 'whatsapp' | 'telegram' | 'max';
  chat_id: string;
  messages: ChatMessage[];
}

export interface ChatMessage {
  sender: string;
  direction: 'in' | 'out';
  content: string;
  timestamp: string;
  type: string;
}

export interface ClientOrder {
  id: string;
  type: string;
  status: string;
  payment_status: string;
  total_amount: number;
  created_at: string;
  payment_card_info?: string;
  paid_at?: string;
  payment_id?: string;
  contact_email?: string;
}

export interface ClientBooking {
  id: string;
  start_time: string;
  status: string;
  service_id: string | null;
}

export interface ClientTask {
  id: string;
  task_number: number;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
}

// ---- Task Links ----

export interface TaskLink {
  link_id: string;
  link_type: 'related' | 'duplicate' | 'parent_child' | 'merged';
  linked_at: string;
  id: string;
  task_number: number;
  title: string;
  status: string;
  priority: string;
  client_name?: string;
  due_date?: string;
  assigned_to_name?: string;
}

// ---- Workday ----

export interface WorkdayShift {
  id: string;
  studio_id: string;
  shift_date?: string;
  status: string;
  shift_kind?: 'studio' | 'virtual';
  is_virtual?: boolean;
  start_time?: string;
  end_time?: string;
  studio_name?: string | null;
  studio_address?: string | null;
  location_code?: string | null;
  checked_in_at?: string | null;
  checked_out_at?: string | null;
  cash_at_open?: number | null;
  cash_at_close?: number | null;
  online_earnings: number;
  online_count: number;
  // Активна ли у студии смены фискальная касса (ATOL). Считается на бэке по
  // pos_fiscal_settings + agents, а не предполагается во фронте.
  fiscal_enabled?: boolean;
  fiscal_device_label?: string | null;
}

export type WorkdayShiftStatus = 'scheduled' | 'active' | 'completed' | 'cancelled';

export interface WorkdayData {
  shift: WorkdayShift | null;
  today_shift_status: WorkdayShiftStatus | null;
  can_start_workday: boolean;
  tasks: (WorkTask & { time_remaining_ms: number | null; is_overdue: boolean })[];
  summary: {
    total: number;
    urgent: number;
    overdue: number;
    completed_today: number;
  };
  ai_briefing: string | null;
}

// ---- Analytics ----

export interface TaskAnalytics {
  overview: {
    total: number;
    completed: number;
    cancelled: number;
    active: number;
    avg_completion_hours: number | null;
    sla_met_percent: number | null;
    overdue_count: number;
  };
  by_type: { task_type: string; count: number; completed: number; avg_hours: number | null }[];
  by_priority: { priority: string; count: number; completed: number; avg_hours: number | null; sla_met: number | null }[];
  by_employee: { employee_id: string; name: string; total: number; completed: number; avg_hours: number | null; active: number }[];
  by_day: { date: string; created: number; completed: number }[];
}

@Injectable({ providedIn: 'root' })
export class TasksApiService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = '/api/tasks';

  getEmployees(): Observable<ApiResponse<{ id: string; display_name: string; role: string }[]>> {
    return this.http.get<ApiResponse<{ id: string; display_name: string; role: string }[]>>(`${this.apiUrl}/employees`);
  }

  getTaskList(params?: { status?: string; studio_id?: string; assigned_to?: string; task_type?: string; priority?: string; page?: number; limit?: number }): Observable<PaginatedResponse<WorkTask>> {
    let httpParams = new HttpParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) httpParams = httpParams.set(key, String(value));
      });
    }
    return this.http.get<PaginatedResponse<WorkTask>>(this.apiUrl, { params: httpParams });
  }

  getBoard(studioId?: string): Observable<ApiResponse<TaskBoard>> {
    let params = new HttpParams();
    if (studioId) params = params.set('studio_id', studioId);
    return this.http.get<ApiResponse<TaskBoard>>(`${this.apiUrl}/board`, { params });
  }

  getMyTasks(params?: { scope?: TaskListScope }): Observable<ApiResponse<WorkTask[]>> {
    let httpParams = new HttpParams();
    if (params?.scope) {
      httpParams = httpParams.set('scope', params.scope);
    }
    return this.http.get<ApiResponse<WorkTask[]>>(`${this.apiUrl}/my`, { params: httpParams });
  }

  getTask(id: string): Observable<ApiResponse<WorkTask>> {
    return this.http.get<ApiResponse<WorkTask>>(`${this.apiUrl}/${id}`);
  }

  getTaskByNumber(taskNumber: number): Observable<ApiResponse<WorkTask>> {
    return this.http.get<ApiResponse<WorkTask>>(`${this.apiUrl}/by-number/${taskNumber}`);
  }

  createTask(task: Partial<WorkTask>): Observable<ApiResponse<WorkTask>> {
    return this.http.post<ApiResponse<WorkTask>>(this.apiUrl, task);
  }

  updateTask(id: string, updates: UpdateWorkTaskRequest): Observable<ApiResponse<WorkTask>> {
    return this.http.put<ApiResponse<WorkTask>>(`${this.apiUrl}/${id}`, updates);
  }

  updateStatus(id: string, status: string): Observable<ApiResponse<WorkTask>> {
    return this.http.put<ApiResponse<WorkTask>>(`${this.apiUrl}/${id}/status`, { status });
  }

  assignTask(id: string, assignedTo: string | null): Observable<ApiResponse<WorkTask>> {
    return this.http.put<ApiResponse<WorkTask>>(`${this.apiUrl}/${id}/assign`, { assigned_to: assignedTo });
  }

  addNote(id: string, content: string, noteType?: string): Observable<ApiResponse<TaskNote>> {
    return this.http.post<ApiResponse<TaskNote>>(`${this.apiUrl}/${id}/notes`, { content, note_type: noteType || 'comment' });
  }

  handoffTask(id: string, handoffNote: string, toEmployeeId?: string): Observable<ApiResponse<TaskHandoff>> {
    return this.http.post<ApiResponse<TaskHandoff>>(`${this.apiUrl}/${id}/handoff`, { handoff_note: handoffNote, to_employee_id: toEmployeeId });
  }

  acknowledgeHandoff(taskId: string, handoffId: string): Observable<ApiResponse<TaskHandoff>> {
    return this.http.put<ApiResponse<TaskHandoff>>(`${this.apiUrl}/${taskId}/handoff/${handoffId}/ack`, {});
  }

  createFromOrder(orderId: string, data?: { assigned_studio_id?: string; priority?: string }): Observable<ApiResponse<WorkTask>> {
    return this.http.post<ApiResponse<WorkTask>>(`${this.apiUrl}/from-order/${orderId}`, data || {});
  }

  // ---- Client Context ----

  getClientContext(taskId: string): Observable<ApiResponse<ClientContext | null>> {
    return this.http.get<ApiResponse<ClientContext | null>>(`${this.apiUrl}/${taskId}/client-context`);
  }

  // ---- Task Links ----

  getLinkedTasks(taskId: string): Observable<ApiResponse<TaskLink[]>> {
    return this.http.get<ApiResponse<TaskLink[]>>(`${this.apiUrl}/${taskId}/linked`);
  }

  linkTask(taskId: string, targetTaskId: string, linkType = 'related'): Observable<ApiResponse<TaskLink>> {
    return this.http.post<ApiResponse<TaskLink>>(`${this.apiUrl}/${taskId}/link`, { target_task_id: targetTaskId, link_type: linkType });
  }

  unlinkTask(taskId: string, linkId: string): Observable<ApiResponse<void>> {
    return this.http.delete<ApiResponse<void>>(`${this.apiUrl}/${taskId}/link/${linkId}`);
  }

  mergeTasks(survivorId: string, sourceTaskId: string): Observable<ApiResponse<WorkTask>> {
    return this.http.post<ApiResponse<WorkTask>>(`${this.apiUrl}/${survivorId}/merge`, { source_task_id: sourceTaskId });
  }

  // ---- Workday ----

  getWorkday(): Observable<ApiResponse<WorkdayData>> {
    return this.http.get<ApiResponse<WorkdayData>>(`${this.apiUrl}/workday`);
  }

  // ---- Analytics ----

  getAnalytics(params?: { date_from?: string; date_to?: string; studio_id?: string; employee_id?: string }): Observable<ApiResponse<TaskAnalytics>> {
    let httpParams = new HttpParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) httpParams = httpParams.set(key, value);
      });
    }
    return this.http.get<ApiResponse<TaskAnalytics>>(`${this.apiUrl}/analytics`, { params: httpParams });
  }
}
