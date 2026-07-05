-- Phase 3C.1: JSONB expression index for channel session lookups
-- Covers all 5+ places with: WHERE channel = $1 AND metadata->>'externalChatId' = $2

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vcs_channel_ext_chat_id
  ON visitor_chat_sessions (channel, (metadata->>'externalChatId'))
  WHERE status NOT IN ('closed');
