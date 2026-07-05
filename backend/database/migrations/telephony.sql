-- Telephony tables for Voximplant integration
-- Call logs and entity links

CREATE TABLE IF NOT EXISTS call_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voximplant_session_id VARCHAR(100) UNIQUE,
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  caller_number VARCHAR(20),
  called_number VARCHAR(20),
  client_user_id UUID REFERENCES users(id),
  operator_user_id UUID REFERENCES users(id),
  status VARCHAR(20) DEFAULT 'ringing',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  answered_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  recording_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS call_entity_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_log_id UUID NOT NULL REFERENCES call_logs(id) ON DELETE CASCADE,
  entity_type VARCHAR(20) NOT NULL,
  entity_id VARCHAR(100) NOT NULL,
  UNIQUE(call_log_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_call_logs_client ON call_logs(client_user_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_operator ON call_logs(operator_user_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_caller ON call_logs(caller_number);
CREATE INDEX IF NOT EXISTS idx_call_logs_started ON call_logs(started_at DESC);

GRANT ALL ON call_logs TO magnus_user;
GRANT ALL ON call_entity_links TO magnus_user;
