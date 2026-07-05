-- Migration 130 — attachment_visibility (P0 CRM-PULT hardening, audit-only slice)
-- Adds visibility classification to order_attachments.
-- Other attachment tables are left untouched in this step.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'attachment_visibility_enum'
  ) THEN
    CREATE TYPE attachment_visibility_enum AS ENUM ('public', 'authenticated', 'private');
  END IF;
END $$;

ALTER TABLE order_attachments
  ADD COLUMN IF NOT EXISTS visibility attachment_visibility_enum NOT NULL DEFAULT 'private';

-- Backfill known-private attachment types (idempotent — visibility already 'private' by default).
UPDATE order_attachments
SET visibility = 'private'
WHERE attachment_type IN ('client_photo', 'form_sample')
  AND visibility IS DISTINCT FROM 'private';

CREATE INDEX IF NOT EXISTS idx_order_attachments_visibility
  ON order_attachments (visibility);
