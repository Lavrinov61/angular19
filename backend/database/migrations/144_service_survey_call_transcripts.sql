-- Store speech recognition results for recorded telephony calls.

CREATE TABLE IF NOT EXISTS call_transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_log_id UUID NOT NULL REFERENCES call_logs(id) ON DELETE CASCADE,
  source VARCHAR(50) NOT NULL DEFAULT 'voximplant_asr',
  transcript_text TEXT NOT NULL,
  confidence NUMERIC,
  language_code VARCHAR(20),
  is_final BOOLEAN NOT NULL DEFAULT true,
  recording_url TEXT,
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_call_transcripts_call_log
  ON call_transcripts(call_log_id, created_at DESC);

GRANT ALL ON call_transcripts TO magnus_user;
