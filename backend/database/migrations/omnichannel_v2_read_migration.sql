-- Omnichannel v2 — Phase 5: Read Migration support
-- Adds missing columns, backfills legacy channel info, creates archive tables
-- Idempotent: safe to re-run

-- ============================================================================
-- 1. Add csat_submitted_at to conversations (missed in original schema)
-- ============================================================================

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS csat_submitted_at TIMESTAMPTZ;

-- Backfill csat_submitted_at from legacy table
UPDATE conversations c
SET csat_submitted_at = vcs.csat_submitted_at
FROM visitor_chat_sessions vcs
WHERE c.legacy_session_id = vcs.id
  AND vcs.csat_submitted_at IS NOT NULL
  AND c.csat_submitted_at IS NULL;

-- ============================================================================
-- 2. Backfill legacyChannel into metadata for web conversations
--    (needed to distinguish old 'online' from 'studio' in analytics)
-- ============================================================================

UPDATE conversations c
SET metadata = c.metadata || jsonb_build_object('legacyChannel', vcs.channel)
FROM visitor_chat_sessions vcs
WHERE c.legacy_session_id = vcs.id
  AND c.channel = 'web'::channel_type
  AND c.metadata->>'legacyChannel' IS NULL
  AND vcs.channel IS NOT NULL;

-- ============================================================================
-- 3. Archive tables for conversation lifecycle (chat-archive.service.ts)
-- ============================================================================

-- conversations_archive: same structure, no FKs, just PK
CREATE TABLE IF NOT EXISTS conversations_archive AS
  SELECT * FROM conversations WHERE false;

DO $$ BEGIN
  ALTER TABLE conversations_archive ADD PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- messages_archive: same structure, no FKs, just PK
CREATE TABLE IF NOT EXISTS messages_archive AS
  SELECT * FROM messages WHERE false;

DO $$ BEGIN
  ALTER TABLE messages_archive ADD PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Index for archive lookups
CREATE INDEX IF NOT EXISTS idx_conv_archive_created
  ON conversations_archive(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_msg_archive_conv
  ON messages_archive(conversation_id);

-- ============================================================================
-- 4. Index for csat_submitted_at (KPI queries)
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_conv_csat_submitted
  ON conversations(csat_submitted_at)
  WHERE csat_submitted_at IS NOT NULL;

\echo '✅ Omnichannel v2 Phase 5: Read migration support ready'
