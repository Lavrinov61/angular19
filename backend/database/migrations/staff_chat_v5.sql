-- Staff Chat v5: Soft-delete, Archive, Compliance
-- 2026-03-21

-- ============================================================================
-- Soft-delete for conversations (audit trail, GDPR compliance)
-- ============================================================================
ALTER TABLE staff_conversations ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE staff_conversations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE staff_conversations ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id);

-- Index for fast filtering of active conversations
CREATE INDEX IF NOT EXISTS idx_staff_conversations_active
  ON staff_conversations (id)
  WHERE deleted_at IS NULL;

-- ============================================================================
-- Mute enforcement tracking (for compliance audit)
-- ============================================================================
ALTER TABLE staff_conversation_participants ADD COLUMN IF NOT EXISTS mute_notified_at TIMESTAMPTZ;

-- ============================================================================
-- Read receipts enhancement (message-level tracking)
-- ============================================================================
ALTER TABLE staff_read_receipts ADD COLUMN IF NOT EXISTS read_by_role VARCHAR(20);

-- ============================================================================
-- Compliance: audit-friendly comment
-- ============================================================================
COMMENT ON COLUMN staff_conversations.deleted_at IS 'Soft-delete timestamp for GDPR compliance. Non-null = conversation deleted. For hard-delete, use archive_messages() trigger.';
COMMENT ON COLUMN staff_conversation_participants.left_at IS 'Participant left or was removed from conversation. NULL = still active participant.';
