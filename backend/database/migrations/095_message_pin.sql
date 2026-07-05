-- 095: Add pin support to messages (visitor chat)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS pinned_by UUID DEFAULT NULL REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_messages_pinned ON messages(conversation_id, pinned_at) WHERE pinned_at IS NOT NULL;
