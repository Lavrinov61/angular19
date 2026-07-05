-- Migration: Add session_number to conversations, event_type to messages
-- Required for chat-session.routes.ts migration to omnichannel v2 tables
-- Idempotent: safe to re-run

-- 1. session_number on conversations (auto-assigned display number for web sessions)
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS session_number INT;

-- 2. event_type on messages (bot event classification: welcome, unpaid_reminder, etc.)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS event_type VARCHAR(50);

-- 3. Index for event_type filtering (used in duplicate-check queries)
CREATE INDEX IF NOT EXISTS idx_msg_event_type
  ON messages(conversation_id, event_type)
  WHERE event_type IS NOT NULL;

\echo '✅ Omnichannel v2: session_number + event_type columns added'
