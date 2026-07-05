-- Migration 108: Add is_system flag to users table
-- Purpose: exclude bot/service accounts (prometheus-scraper, future integrations)
--   from staff chat contact list and mentions.
-- Idempotent: safe to re-run.

BEGIN;

-- 1. Add column (idempotent)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN users.is_system IS
  'true for bot/service accounts (metrics scrapers, webhooks, integrations). Excluded from staff chat contacts, presence, mentions, staff-list.';

-- 2. Backfill: mark all @*.internal emails as system accounts
UPDATE users
SET is_system = true
WHERE email ILIKE '%@%.internal'
  AND is_system = false;

-- 3. Partial index for filtered queries (staff-chat/contacts/presence)
CREATE INDEX IF NOT EXISTS idx_users_staff_active
  ON users (role, is_active)
  WHERE is_system = false;

COMMIT;
