-- Migration 102: Backfill deprecated conversation fields from contacts (Phase 0)
-- This migration prepares for removing deprecated columns:
-- - conversations.visitor_phone
-- - conversations.user_id
-- Both will now be read from contacts table instead

BEGIN;

-- ============================================================================
-- 1. BACKFILL visitor_phone from contacts.phone
-- ============================================================================
-- For all conversations that have contact_id but empty visitor_phone,
-- populate visitor_phone from contacts.phone for backward compatibility

UPDATE conversations
SET visitor_phone = ct.phone, updated_at = NOW()
FROM contacts ct
WHERE conversations.contact_id = ct.id
  AND conversations.visitor_phone IS NULL
  AND ct.phone IS NOT NULL;

-- Log the count
DO $$
DECLARE
  backfill_count INT;
BEGIN
  SELECT count(*)
  INTO backfill_count
  FROM conversations c
  WHERE c.visitor_phone IS NOT NULL;

  RAISE NOTICE 'visitor_phone backfill complete. Total non-null records: %', backfill_count;
END $$;


-- ============================================================================
-- 2. BACKFILL user_id from contacts.user_id
-- ============================================================================
-- For all conversations that have contact_id but empty user_id,
-- populate user_id from contacts.user_id for backward compatibility

UPDATE conversations
SET user_id = ct.user_id, updated_at = NOW()
FROM contacts ct
WHERE conversations.contact_id = ct.id
  AND conversations.user_id IS NULL
  AND ct.user_id IS NOT NULL;

-- Log the count
DO $$
DECLARE
  backfill_count INT;
BEGIN
  SELECT count(*)
  INTO backfill_count
  FROM conversations c
  WHERE c.user_id IS NOT NULL;

  RAISE NOTICE 'user_id backfill complete. Total non-null records: %', backfill_count;
END $$;


-- ============================================================================
-- 3. ANALYZE updated tables
-- ============================================================================
-- Update statistics for query planner to use new data distribution

ANALYZE conversations;


-- ============================================================================
-- Migration Notes:
-- ============================================================================
-- This is Phase 0 of the deprecated fields cleanup:
--
-- Phase 1: Fix crm_inbox_view (schema.sql)
--   - Replace s.user_id with ct.user_id in jsonb metadata
--   - REFRESH MATERIALIZED VIEW CONCURRENTLY public.crm_inbox_view
--
-- Phase 2: Fix READ operations (2-3 hours)
--   - chat-admin.routes.ts:93 — orders lookup
--   - photo-approvals.routes.ts:73 — conversations lookup
--   - replay.routes.ts:293, 334 — user search
--   - approval-client-resolver.service.ts:25 — fallback
--   - client-context.service.ts:903 — user_id query
--   - payment.service.ts:149, 457 — loyalty lookup
--
-- Phase 3: Remove unnecessary WRITE (1-2 hours)
--   - conversation-adapter.ts:372-376 — remove from generic updateConversation()
--   - conversation-manager.ts:84 — remove webhook visitor_name update
--   - crm-clients.routes.ts:492 — remove from merge logic
--
-- Phase 4: Monitor backward compat (2 weeks)
--   - Keep all remaining WRITE operations active for 2 weeks
--   - Monitor logs for stale data issues
--   - Remove deprecated fields in next major release

COMMIT;
