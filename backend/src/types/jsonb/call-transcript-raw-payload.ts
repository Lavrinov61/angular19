/** JSONB contract for call_transcripts.raw_payload. */

export interface CallTranscriptRawPayload {
  event: string;
  sessionId: string;
  callerNumber?: string;
  calledNumber?: string;
  reason?: string;
  failureCode?: number;
  failureName?: string;
  durationSeconds?: number;
  question?: string;
  confidence?: number;
  languageCode?: string;
  recordingUrl?: string;
  occurredAt?: string;
}
