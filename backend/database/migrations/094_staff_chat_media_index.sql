-- Media gallery index for efficient queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_staff_messages_media
  ON staff_messages (conversation_id, created_at DESC)
  WHERE deleted_at IS NULL AND attachment_url IS NOT NULL;
