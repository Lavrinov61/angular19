/** View types for service survey response lists and transcript projections. */

export type ServiceSurveyResponseStatus =
  | 'queued'
  | 'connecting'
  | 'ringing'
  | 'active'
  | 'completed'
  | 'missed'
  | 'failed';

export interface ServiceSurveyResponseFilters {
  q?: string;
  status?: ServiceSurveyResponseStatus;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface ServiceSurveyResponseRow {
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

export interface ServiceSurveyResponseCountRow {
  total: string;
}

export interface ServiceSurveyRecordingRow {
  call_id: string;
  recording_url: string | null;
}
