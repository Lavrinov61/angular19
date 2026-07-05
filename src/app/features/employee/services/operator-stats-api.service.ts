import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';

export interface OperatorStatsData {
  summary: {
    totalChats: number;
    totalMessages: number;
    avgFirstResponseSec: number | null;
    avgResolutionSec: number | null;
  };
  operators: {
    operator_id: string;
    operator_name: string;
    chats_handled: number;
    messages_sent: number;
    avg_first_response_sec: number | null;
    avg_resolution_sec: number | null;
    active_sessions: number;
    avg_csat: number | null;
  }[];
}

@Injectable({ providedIn: 'root' })
export class OperatorStatsApiService {
  private readonly http = inject(HttpClient);

  getStats(period: string): Observable<OperatorStatsData> {
    return this.http.get<{ success: boolean; data: OperatorStatsData }>(
      `/api/crm/operator-stats?period=${period}`
    ).pipe(map(res => res.data));
  }
}
