import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';

export interface ClientNote {
  id: string;
  text: string;
  pinned: boolean;
  created_at: string;
  author_name: string;
}

export interface ClientOrder {
  type: 'booking' | 'print_order' | 'pos_receipt';
  id: string;
  date: string;
  description: string;
  amount: number;
  status: string;
  client_name: string;
}

export interface TimelineEvent {
  type: 'booking' | 'order' | 'pos_receipt' | 'loyalty' | 'message' | 'call' | 'note' | 'subscription';
  id: string;
  ts: string;
  title: string;
  detail: string;
  amount: number | null;
}

export interface ClientLookupResult {
  name: string;
  phone: string;
  email: string | null;
  source: string;
  source_id: string | null;
  first_seen: string;
  last_activity: string;
  total_orders: number;
}

@Injectable({ providedIn: 'root' })
export class CrmClientsApiService {
  private readonly http = inject(HttpClient);

  /**
   * Поиск клиента по полному телефону (минимум 10 цифр).
   * Не позволяет просматривать весь список — только точечный поиск.
   */
  lookupClient(phone: string): Observable<ClientLookupResult[]> {
    return this.http.get<{ success: boolean; data: ClientLookupResult[] }>(
      `/api/crm/clients`, { params: { search: phone } },
    ).pipe(map(r => r.data));
  }

  /**
   * Все заказы клиента по телефону (все каналы)
   */
  getClientOrders(phone: string): Observable<ClientOrder[]> {
    return this.http.get<{ success: boolean; data: ClientOrder[] }>(
      `/api/crm/clients/${encodeURIComponent(phone)}/orders`,
    ).pipe(map(r => r.data));
  }

  /**
   * Заметки по клиенту
   */
  getNotes(phone: string): Observable<ClientNote[]> {
    return this.http.get<{ success: boolean; data: ClientNote[] }>(
      `/api/crm/clients/${encodeURIComponent(phone)}/notes`,
    ).pipe(map(r => r.data));
  }

  addNote(phone: string, text: string, pinned = false): Observable<ClientNote> {
    return this.http.post<{ success: boolean; data: ClientNote }>(
      `/api/crm/clients/${encodeURIComponent(phone)}/notes`,
      { text, pinned },
    ).pipe(map(r => r.data));
  }

  deleteNote(phone: string, noteId: string): Observable<void> {
    return this.http.delete<void>(
      `/api/crm/clients/${encodeURIComponent(phone)}/notes/${noteId}`,
    );
  }

  pinNote(phone: string, noteId: string, pinned: boolean): Observable<void> {
    return this.http.patch<void>(
      `/api/crm/clients/${encodeURIComponent(phone)}/notes/${noteId}/pin`,
      { pinned },
    );
  }

  getTimeline(phone: string, limit = 50): Observable<TimelineEvent[]> {
    return this.http.get<{ success: boolean; data: TimelineEvent[] }>(
      `/api/crm/clients/${encodeURIComponent(phone)}/timeline`,
      { params: { limit: limit.toString() } },
    ).pipe(map(r => r.data));
  }

  getTimelineByUserId(userId: string, limit = 50): Observable<TimelineEvent[]> {
    return this.http.get<{ success: boolean; data: TimelineEvent[] }>(
      `/api/crm/clients/user/${encodeURIComponent(userId)}/timeline`,
      { params: { limit: limit.toString() } },
    ).pipe(map(r => r.data));
  }
}
