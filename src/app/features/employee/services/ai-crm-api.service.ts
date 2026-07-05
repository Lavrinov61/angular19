import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ChatSummary {
  summary: string;
  clientIntent: string;
  keyFacts: string[];
  sentiment: 'positive' | 'neutral' | 'negative';
}

export interface SuggestedReply {
  text: string;
  tone: 'friendly' | 'professional' | 'urgent';
}

export interface AssignmentSuggestion {
  employeeId: string;
  employeeName: string;
  reason: string;
  score: number;
}

export interface PriorityScore {
  priority: 'low' | 'normal' | 'urgent' | 'vip';
  reason: string;
  confidence: number;
}

export interface FollowUpCandidate {
  sessionId: string;
  type: string;
  message: { text: string; channel: string; delay_minutes: number };
}

export interface CRMInsights {
  forecast: { date: string; expectedOrders: number; expectedRevenue: number }[];
  recommendations: string[];
  trends: { metric: string; direction: 'up' | 'down' | 'stable'; change: number }[];
}

@Injectable({ providedIn: 'root' })
export class AiCrmApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/ai-crm';

  /** A1: Получить AI-резюме чата */
  getChatSummary(sessionId: string): Observable<ChatSummary> {
    return this.http.get<{ success: boolean; data: ChatSummary }>(`${this.base}/summary/${sessionId}`)
      .pipe(map(r => r.data));
  }

  /** A2: Получить 3 варианта ответа */
  getSuggestedReplies(sessionId: string): Observable<SuggestedReply[]> {
    return this.http.get<{ success: boolean; data: SuggestedReply[] }>(`${this.base}/suggestions/${sessionId}`)
      .pipe(map(r => r.data));
  }

  /** A3: Получить рекомендации по назначению */
  getAssignmentSuggestions(taskId: string): Observable<AssignmentSuggestion[]> {
    return this.http.get<{ success: boolean; data: AssignmentSuggestion[] }>(`${this.base}/assignment/${taskId}`)
      .pipe(map(r => r.data));
  }

  /** A3: Автоназначить задачу */
  autoAssignTask(taskId: string): Observable<{ assignedTo: string }> {
    return this.http.post<{ success: boolean; data: { assignedTo: string } }>(`${this.base}/auto-assign/${taskId}`, {})
      .pipe(map(r => r.data));
  }

  /** A4: Определить приоритет задачи */
  scorePriority(title: string, description: string, clientPhone?: string): Observable<PriorityScore> {
    return this.http.post<{ success: boolean; data: PriorityScore }>(`${this.base}/priority`, {
      title, description, clientPhone
    }).pipe(map(r => r.data));
  }

  /** A5: Кандидаты для follow-up */
  getFollowUpCandidates(): Observable<FollowUpCandidate[]> {
    return this.http.get<{ success: boolean; data: FollowUpCandidate[] }>(`${this.base}/follow-up/candidates`)
      .pipe(map(r => r.data));
  }

  /** A6: AI-аналитика */
  getInsights(): Observable<CRMInsights> {
    return this.http.get<{ success: boolean; data: CRMInsights }>(`${this.base}/insights`)
      .pipe(map(r => r.data));
  }
}
