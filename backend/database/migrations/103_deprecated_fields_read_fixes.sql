-- Migration 103: Fix deprecated field READ operations (Phase 2)
-- This migration documents the required code changes for READ operations
-- These changes must be made in TypeScript backend code, not SQL

-- ============================================================================
-- REQUIRED CODE CHANGES (to be done in backend code)
-- ============================================================================

-- 1. /backend/src/routes/photo-approvals.routes.ts:73
--    BEFORE:
--      SELECT id FROM conversations WHERE user_id = $1
--    AFTER:
--      SELECT c.id FROM conversations c
--      LEFT JOIN contacts ct ON ct.id = c.contact_id
--      WHERE ct.user_id = $1

-- 2. /backend/src/routes/replay.routes.ts:293
--    BEFORE:
--      rs.user_id IN (SELECT id FROM users WHERE phone LIKE $1)
--    AFTER:
--      rs.contact_id IN (SELECT ct.id FROM contacts ct WHERE ct.phone LIKE $1)

-- 3. /backend/src/routes/replay.routes.ts:334-341
--    Add LEFT JOIN:
--      LEFT JOIN contacts ct ON ct.id = rs.contact_id
--    Replace:
--      u.display_name AS user_name, u.phone AS user_phone
--    With:
--      COALESCE(u.display_name, ct.display_name) AS user_name,
--      COALESCE(u.phone, ct.phone) AS user_phone

-- 4. /backend/src/services/approval-client-resolver.service.ts:25
--    BEFORE:
--      (SELECT user_id FROM conversations WHERE id = $1 AND user_id IS NOT NULL LIMIT 1)
--    AFTER:
--      (SELECT ct.user_id FROM conversations c
--       LEFT JOIN contacts ct ON ct.id = c.contact_id
--       WHERE c.id = $1 AND ct.user_id IS NOT NULL LIMIT 1)

-- 5. /backend/src/services/client-context.service.ts:903
--    BEFORE:
--      SELECT c.user_id FROM conversations c
--    AFTER:
--      SELECT ct.user_id FROM conversations c
--      LEFT JOIN contacts ct ON ct.id = c.contact_id

-- 6. /backend/src/services/payment.service.ts:149, 457
--    Add LEFT JOIN:
--      LEFT JOIN contacts ct ON ct.id = c.contact_id
--    Replace:
--      SELECT c.user_id
--    With:
--      SELECT ct.user_id

-- Migration Note:
-- This migration is SQL documentation only.
-- All changes above must be made in TypeScript backend code.
-- See DEPRECATED_FIELDS_MIGRATION_REPORT.md for full details.
