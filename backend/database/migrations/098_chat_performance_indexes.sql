-- 098_chat_performance_indexes.sql
-- Performance indexes for chat conversations query patterns

-- Hot inbox: open conversations sorted by last activity
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conv_inbox_hot
  ON conversations (status, updated_at DESC)
  WHERE status IN ('active', 'pending', 'waiting');

-- Channel + status filtering with creation time sort
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conv_channel_status_created
  ON conversations (channel, status, created_at DESC);

-- Unread conversations for operator badge counts
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conv_unread
  ON conversations (assigned_operator_id, status, updated_at DESC)
  WHERE status IN ('active', 'pending');

-- User conversations for LK history
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conv_user_created
  ON conversations (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;
