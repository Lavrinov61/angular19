-- Staff chat bookmarks (saved messages)
CREATE TABLE IF NOT EXISTS staff_bookmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES staff_messages(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES staff_conversations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_bookmarks_user
  ON staff_bookmarks(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_staff_bookmarks_message
  ON staff_bookmarks(message_id);
