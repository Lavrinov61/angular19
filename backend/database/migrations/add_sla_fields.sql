-- SLA tracking fields for visitor_chat_sessions
ALTER TABLE visitor_chat_sessions
  ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
