BEGIN;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE visitor_chat_sessions
  ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_conversations_private_owner
  ON conversations (assigned_operator_id, last_message_at DESC)
  WHERE is_private = true;

CREATE INDEX IF NOT EXISTS idx_visitor_chat_sessions_private_owner
  ON visitor_chat_sessions (assigned_operator_id, last_message_at DESC)
  WHERE is_private = true;

CREATE INDEX IF NOT EXISTS idx_conversations_private_owner_created
  ON conversations (assigned_operator_id, created_at DESC)
  WHERE is_private = true;

CREATE INDEX IF NOT EXISTS idx_visitor_chat_sessions_private_owner_created
  ON visitor_chat_sessions (assigned_operator_id, created_at DESC)
  WHERE is_private = true;

CREATE TABLE IF NOT EXISTS chat_ownership_history (
  id BIGSERIAL PRIMARY KEY,
  resource_type VARCHAR(32) NOT NULL CHECK (resource_type IN ('conversation', 'visitor_session')),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  visitor_session_id UUID REFERENCES visitor_chat_sessions(id) ON DELETE CASCADE,
  action VARCHAR(32) NOT NULL CHECK (action IN ('assign','unassign','transfer','claim-private','release-private')),
  from_operator_id UUID REFERENCES users(id) ON DELETE SET NULL,
  to_operator_id UUID REFERENCES users(id) ON DELETE SET NULL,
  changed_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  note TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chat_ownership_history_target_one CHECK (
    (conversation_id IS NOT NULL)::int + (visitor_session_id IS NOT NULL)::int = 1
  )
);

CREATE INDEX IF NOT EXISTS idx_chat_ownership_history_conversation
  ON chat_ownership_history (conversation_id, changed_at DESC)
  WHERE conversation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chat_ownership_history_visitor_session
  ON chat_ownership_history (visitor_session_id, changed_at DESC)
  WHERE visitor_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chat_ownership_history_changed_by
  ON chat_ownership_history (changed_by, changed_at DESC);

COMMIT;
