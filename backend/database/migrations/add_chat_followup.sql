-- Follow-up / Snooze для чат-сессий
CREATE TABLE IF NOT EXISTS chat_followups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES visitor_chat_sessions(id) ON DELETE CASCADE,
  operator_id UUID NOT NULL REFERENCES users(id),
  follow_up_at TIMESTAMPTZ NOT NULL,
  note TEXT,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_followup_pending ON chat_followups (follow_up_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_followup_session ON chat_followups (session_id);
