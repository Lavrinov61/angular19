-- Migration 100: Visitor chat enhancements — soft delete + FTS search
-- Idempotent: safe to re-run

-- 1. Soft delete
ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- 2. FTS search_vector
ALTER TABLE messages ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- 3. Trigger auto-update search_vector
CREATE OR REPLACE FUNCTION messages_update_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.content IS NOT NULL AND NEW.content != '' THEN
    NEW.search_vector := to_tsvector('russian', NEW.content);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_messages_search_vector ON messages;
CREATE TRIGGER trg_messages_search_vector
  BEFORE INSERT OR UPDATE OF content ON messages
  FOR EACH ROW EXECUTE FUNCTION messages_update_search_vector();

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_msg_search_vector ON messages USING gin(search_vector) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_msg_not_deleted ON messages(conversation_id, created_at DESC) WHERE deleted_at IS NULL;

-- 5. Backfill existing messages
UPDATE messages SET search_vector = to_tsvector('russian', content) WHERE search_vector IS NULL AND content IS NOT NULL AND content != '';
