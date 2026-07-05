-- Staff Chat v3: Security + Enterprise Features
-- 2026-03-05

-- ============================================================================
-- Phase 1: Security (participation check requires left_at)
-- ============================================================================

ALTER TABLE staff_conversation_participants ADD COLUMN IF NOT EXISTS left_at TIMESTAMPTZ;

-- ============================================================================
-- Phase 2: Edit/Delete + Roles + Mute
-- ============================================================================

-- Message soft delete + edit
ALTER TABLE staff_messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE staff_messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

-- Participant roles + settings
ALTER TABLE staff_conversation_participants ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'member';
ALTER TABLE staff_conversation_participants ADD COLUMN IF NOT EXISTS muted_until TIMESTAMPTZ;

-- Set creator as owner for existing group conversations
UPDATE staff_conversation_participants p
SET role = 'owner'
FROM staff_conversations c
WHERE p.conversation_id = c.id
  AND p.user_id = c.created_by
  AND c.type IN ('group', 'general')
  AND p.role = 'member';

-- Index for filtering deleted messages
CREATE INDEX IF NOT EXISTS idx_staff_messages_not_deleted
  ON staff_messages(conversation_id, created_at)
  WHERE deleted_at IS NULL;

-- Index for active participants
CREATE INDEX IF NOT EXISTS idx_staff_participants_active
  ON staff_conversation_participants(conversation_id, user_id)
  WHERE left_at IS NULL;
