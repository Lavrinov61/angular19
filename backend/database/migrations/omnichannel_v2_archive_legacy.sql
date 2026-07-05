-- Omnichannel v2 Phase 7: Archive legacy tables
-- All production code now reads/writes conversations/messages/media_attachments.
-- These tables are renamed to _archived for 30-day observation before DROP.
--
-- Idempotent: IF EXISTS on every operation.
-- Rollback: ALTER TABLE ... RENAME TO original_name
--
-- NOTE: email_messages and email_attachments are NOT archived yet —
-- crm-email.routes.ts still actively reads/writes them.

-- 1. Rename visitor_chat_sessions → _archived
ALTER TABLE IF EXISTS visitor_chat_sessions RENAME TO visitor_chat_sessions_archived;

-- 2. Rename visitor_chat_messages → _archived
ALTER TABLE IF EXISTS visitor_chat_messages RENAME TO visitor_chat_messages_archived;

-- 3. Rename outbound_delivery_log → _archived (replaced by outbound_queue table)
ALTER TABLE IF EXISTS outbound_delivery_log RENAME TO outbound_delivery_log_archived;

-- 4. Rename indexes (avoid name conflicts if tables are recreated)
DO $$
BEGIN
  -- visitor_chat_sessions indexes
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_vcs_channel') THEN
    ALTER INDEX idx_vcs_channel RENAME TO idx_vcs_channel_archived;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_vcs_status') THEN
    ALTER INDEX idx_vcs_status RENAME TO idx_vcs_status_archived;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_vcs_visitor_id') THEN
    ALTER INDEX idx_vcs_visitor_id RENAME TO idx_vcs_visitor_id_archived;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_vcs_user_id') THEN
    ALTER INDEX idx_vcs_user_id RENAME TO idx_vcs_user_id_archived;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_vcs_last_message') THEN
    ALTER INDEX idx_vcs_last_message RENAME TO idx_vcs_last_message_archived;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_vcs_created') THEN
    ALTER INDEX idx_vcs_created RENAME TO idx_vcs_created_archived;
  END IF;

  -- visitor_chat_messages indexes
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_vcm_session_id') THEN
    ALTER INDEX idx_vcm_session_id RENAME TO idx_vcm_session_id_archived;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_vcm_external_id') THEN
    ALTER INDEX idx_vcm_external_id RENAME TO idx_vcm_external_id_archived;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_vcm_created') THEN
    ALTER INDEX idx_vcm_created RENAME TO idx_vcm_created_archived;
  END IF;
END $$;

-- Log completion
DO $$ BEGIN RAISE NOTICE 'Omnichannel v2 Phase 7: Legacy tables archived successfully'; END $$;
