-- v1_to_v2_foundation.sql — Phase 1 of v1->v2 chat migration
-- Idempotent: safe to run multiple times

-- 1. Compatibility: attachment_url in messages (v1 stored in visitor_chat_messages)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_url VARCHAR(500);

-- 2. conversation_tags (replaces visitor_chat_session_tags)
CREATE TABLE IF NOT EXISTS conversation_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  tag VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(conversation_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_conversation_tags_conv ON conversation_tags(conversation_id);

-- 3. UNIQUE constraint for preventing duplicate conversations (BUG-8)
-- First, close older duplicates (keep newest per channel+external_chat_id)
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY channel, external_chat_id
           ORDER BY created_at DESC
         ) AS rn
  FROM conversations
  WHERE status NOT IN ('closed')
    AND external_chat_id IS NOT NULL
    AND external_chat_id != ''
)
UPDATE conversations
SET status = 'closed', closed_at = NOW(), updated_at = NOW()
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Now create the partial unique index (exclude NULLs and empty external_chat_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_channel_ext_unique
  ON conversations(channel, external_chat_id)
  WHERE status NOT IN ('closed')
    AND external_chat_id IS NOT NULL
    AND external_chat_id != '';

-- 4. Backfill: photo_print_orders does not have conversation_id column yet.
-- When the column is added (Phase 2), backfill via:
--   UPDATE photo_print_orders ppo SET conversation_id = c.id
--   FROM conversations c WHERE c.legacy_session_id = ppo.chat_session_id
--   AND ppo.conversation_id IS NULL AND ppo.chat_session_id IS NOT NULL;

-- 5. resolve_conversation_id — PG function for fallback lookup
-- Accepts TEXT, attempts UUID cast; falls back to legacy_session_id lookup.
-- Returns NULL if input is not a valid UUID format.
CREATE OR REPLACE FUNCTION resolve_conversation_id(p_id TEXT)
RETURNS UUID AS $$
DECLARE
  v_uuid UUID;
  v_result UUID;
BEGIN
  -- Try to cast input to UUID
  BEGIN
    v_uuid := p_id::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN NULL;
  END;

  -- Direct ID lookup
  SELECT id INTO v_result FROM conversations WHERE id = v_uuid;
  IF v_result IS NOT NULL THEN
    RETURN v_result;
  END IF;

  -- Fallback: legacy_session_id lookup
  SELECT id INTO v_result
  FROM conversations
  WHERE legacy_session_id = v_uuid
  ORDER BY created_at DESC
  LIMIT 1;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE;
