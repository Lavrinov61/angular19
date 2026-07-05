-- Enterprise Indexes & Schema Additions
-- Run with: psql -f enterprise_indexes.sql

-- Undelivered operator messages (outbound worker queries)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vcm_undelivered
  ON visitor_chat_messages(id) WHERE delivered_at IS NULL AND sender_type = 'operator';

-- Delivery log by channel+time (admin panel)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_odl_channel_created
  ON outbound_delivery_log(channel, created_at DESC);

-- Archive candidates (efficient archive query)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vcs_archive_candidates
  ON visitor_chat_sessions(COALESCE(resolved_at, updated_at, created_at))
  WHERE status = 'closed';

-- External message dedup (inbound pipeline hot path)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vcm_ext_msg_id
  ON visitor_chat_messages(external_message_id) WHERE external_message_id IS NOT NULL;

-- Quick Replies: category + created_by columns
ALTER TABLE chat_quick_replies ADD COLUMN IF NOT EXISTS category VARCHAR(50);
ALTER TABLE chat_quick_replies ADD COLUMN IF NOT EXISTS created_by UUID;

CREATE INDEX IF NOT EXISTS idx_cqr_category
  ON chat_quick_replies(category) WHERE is_active = true;
