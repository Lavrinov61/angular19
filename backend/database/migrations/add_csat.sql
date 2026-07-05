-- CSAT (Customer Satisfaction) для чат-сессий
ALTER TABLE visitor_chat_sessions
  ADD COLUMN IF NOT EXISTS csat_score SMALLINT CHECK (csat_score BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS csat_comment TEXT,
  ADD COLUMN IF NOT EXISTS csat_submitted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_vcs_csat ON visitor_chat_sessions (csat_score)
  WHERE csat_score IS NOT NULL;
