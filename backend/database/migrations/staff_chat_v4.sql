-- Staff Chat v4: Reactions, Pins, Mentions, FTS, Forwarding
-- 2026-03-05

-- ============================================================================
-- Reactions
-- ============================================================================
CREATE TABLE IF NOT EXISTS staff_message_reactions (
  message_id UUID REFERENCES staff_messages(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  emoji VARCHAR(10) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id, emoji)
);

-- ============================================================================
-- Pinned messages
-- ============================================================================
ALTER TABLE staff_messages ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;
ALTER TABLE staff_messages ADD COLUMN IF NOT EXISTS pinned_by UUID REFERENCES users(id);

-- ============================================================================
-- Mentions
-- ============================================================================
CREATE TABLE IF NOT EXISTS staff_mentions (
  message_id UUID REFERENCES staff_messages(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, user_id)
);

-- ============================================================================
-- Full-text search (Russian language config)
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_staff_messages_fts
  ON staff_messages USING gin(to_tsvector('russian', content));

-- ============================================================================
-- Forwarding
-- ============================================================================
ALTER TABLE staff_messages ADD COLUMN IF NOT EXISTS is_forwarded BOOLEAN DEFAULT false;
ALTER TABLE staff_messages ADD COLUMN IF NOT EXISTS forwarded_from_name VARCHAR(255);
