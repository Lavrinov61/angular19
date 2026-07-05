-- Staff Chat Enterprise Hardening
-- 1. Auto-leave deactivated users from conversations (trigger)
-- 2. Soft-delete conversations (archived_at, deleted_at)
-- 3. Last seen tracking (last_seen_at on users)

BEGIN;

-- ============================================================================
-- 1. Auto-leave: when user.is_active → false, auto-set left_at in all chats
-- ============================================================================

CREATE OR REPLACE FUNCTION staff_chat_auto_leave_on_deactivation()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.is_active = true AND NEW.is_active = false THEN
    -- Deactivated: leave all chats
    UPDATE staff_conversation_participants
    SET left_at = NOW()
    WHERE user_id = NEW.id
      AND left_at IS NULL;
  ELSIF OLD.is_active = false AND NEW.is_active = true THEN
    -- Reactivated: auto-rejoin general chat only
    UPDATE staff_conversation_participants
    SET left_at = NULL
    WHERE user_id = NEW.id
      AND conversation_id IN (SELECT id FROM staff_conversations WHERE type = 'general' AND deleted_at IS NULL)
      AND left_at IS NOT NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_staff_chat_auto_leave ON users;
CREATE TRIGGER trg_staff_chat_auto_leave
  AFTER UPDATE OF is_active ON users
  FOR EACH ROW
  WHEN (OLD.is_active IS DISTINCT FROM NEW.is_active)
  EXECUTE FUNCTION staff_chat_auto_leave_on_deactivation();

-- ============================================================================
-- 2. Soft-delete conversations
-- ============================================================================

ALTER TABLE staff_conversations
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id);

-- Index for filtering active conversations
CREATE INDEX IF NOT EXISTS idx_staff_conversations_active
  ON staff_conversations (deleted_at) WHERE deleted_at IS NULL;

-- ============================================================================
-- 3. Last seen tracking
-- ============================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

-- Index for presence queries
CREATE INDEX IF NOT EXISTS idx_users_last_seen
  ON users (last_seen_at DESC NULLS LAST)
  WHERE role IN ('admin', 'manager', 'employee', 'photographer');

COMMIT;
