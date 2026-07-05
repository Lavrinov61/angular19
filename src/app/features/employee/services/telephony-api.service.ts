import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface CallLog {
  id: string;
  voximplant_session_id: string | null;
  direction: 'inbound' | 'outbound';
  caller_number: string;
  called_number: string | null;
  client_user_id: string | null;
  operator_user_id: string | null;
  client_name: string | null;
  operator_name: string | null;
  status: string;
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  recording_url: string | null;
  notes: string | null;
  links?: { entity_type: string; entity_id: string }[];
}

export interface ServiceSurveyCallRequest {
  phone: string;
  order_id?: string;
  client_id?: string;
}

export interface ServiceSurveyCallResponse {
  callId: string;
  clientName: string | null;
  sessionId: string;
  status: string;
  question: string;
  queued: boolean;
  queuePosition: number;
}

export type ServiceSurveyResponseStatus =
  | 'queued'
  | 'connecting'
  | 'ringing'
  | 'active'
  | 'completed'
  | 'missed'
  | 'failed';

export interface ServiceSurveyResponseItem {
  call_id: string;
  session_id: string | null;
  status: string;
  caller_number: string | null;
  called_number: string | null;
  client_user_id: string | null;
  client_name: string | null;
  operator_user_id: string | null;
  operator_name: string | null;
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  call_recording_url: string | null;
  notes: string | null;
  order_id: string | null;
  transcript_id: string | null;
  transcript_text: string | null;
  confidence: number | null;
  language_code: string | null;
  transcript_recording_url: string | null;
  transcript_created_at: string | null;
}

export interface ServiceSurveyResponsesQuery {
  q?: string;
  status?: ServiceSurveyResponseStatus;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export type OpenAiRealtimeOutputModality = 'audio' | 'text';

export interface OpenAiRealtimeClientSecret {
  value: string;
  expires_at: number;
  session: {
    id: string;
    object: string;
    type: string;
    model: string;
    instructions?: string | null;
    output_modalities?: OpenAiRealtimeOutputModality[] | null;
    audio?: {
      output?: {
        voice?: string | null;
      };
    } | null;
  };
}

export interface CreateOpenAiRealtimeTokenRequest {
  model?: string;
  voice?: string;
  instructions?: string;
  outputModalities?: OpenAiRealtimeOutputModality[];
  ttlSeconds?: number;
}

@Injectable({ providedIn: 'root' })
export class TelephonyApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/telephony';

  makeCall(phone: string): Observable<{ success: boolean; data: { callId: string; clientName: string | null } }> {
    return this.http.post<{ success: boolean; data: { callId: string; clientName: string | null } }>(
      `${this.base}/call`, { phone }
    );
  }

  startServiceSurveyCall(
    payload: ServiceSurveyCallRequest,
  ): Observable<{ success: boolean; data: ServiceSurveyCallResponse }> {
    return this.http.post<{ success: boolean; data: ServiceSurveyCallResponse }>(
      `${this.base}/service-survey/call`,
      payload,
    );
  }

  getCallHistory(params?: {
    phone?: string;
    operator_id?: string;
    client_id?: string;
    direction?: string;
    limit?: number;
    offset?: number;
  }): Observable<{ success: boolean; data: CallLog[]; total: number }> {
    return this.http.get<{ success: boolean; data: CallLog[]; total: number }>(
      `${this.base}/calls`, { params: params as Record<string, string> }
    );
  }

  getCallById(id: string): Observable<{ success: boolean; data: CallLog }> {
    return this.http.get<{ success: boolean; data: CallLog }>(`${this.base}/calls/${id}`);
  }

  getServiceSurveyResponses(
    query: ServiceSurveyResponsesQuery = {},
  ): Observable<{ success: boolean; data: ServiceSurveyResponseItem[]; total: number }> {
    let params = new HttpParams();
    if (query.q) params = params.set('q', query.q);
    if (query.status) params = params.set('status', query.status);
    if (query.from) params = params.set('from', query.from);
    if (query.to) params = params.set('to', query.to);
    if (query.limit !== undefined) params = params.set('limit', String(query.limit));
    if (query.offset !== undefined) params = params.set('offset', String(query.offset));

    return this.http.get<{ success: boolean; data: ServiceSurveyResponseItem[]; total: number }>(
      `${this.base}/service-survey/responses`,
      { params },
    );
  }

  serviceSurveyRecordingUrl(callId: string): string {
    return `${this.base}/service-survey/responses/${encodeURIComponent(callId)}/recording`;
  }

  getServiceSurveyRecording(callId: string): Observable<Blob> {
    return this.http.get(this.serviceSurveyRecordingUrl(callId), { responseType: 'blob' });
  }

  linkCall(callId: string, entityType: string, entityId: string): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(
      `${this.base}/calls/${callId}/link`, { entity_type: entityType, entity_id: entityId }
    );
  }

  uploadRecording(callId: string, blob: Blob): Observable<{ success: boolean; data: { recording_url: string } }> {
    const formData = new FormData();
    formData.append('recording', blob, `call-${callId}.webm`);
    return this.http.post<{ success: boolean; data: { recording_url: string } }>(
      `${this.base}/calls/${callId}/recording`, formData
    );
  }

  createOpenAiRealtimeToken(
    payload: CreateOpenAiRealtimeTokenRequest = {},
  ): Observable<{ success: boolean; data: OpenAiRealtimeClientSecret }> {
    return this.http.post<{ success: boolean; data: OpenAiRealtimeClientSecret }>(
      `${this.base}/openai/realtime-token`,
      payload,
    );
  }
}
