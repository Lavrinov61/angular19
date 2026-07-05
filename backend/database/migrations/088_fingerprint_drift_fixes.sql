-- Migration 088: Fingerprint drift fixes
-- Индекс на conversations.visitor_id для ускорения chat session lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_visitor_id
  ON conversations(visitor_id) WHERE visitor_id IS NOT NULL;
