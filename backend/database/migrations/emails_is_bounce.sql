-- Migration: is_bounce column for email_messages
-- Filters out bounce/delivery-failure emails from inbox view

-- UP
ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS is_bounce BOOLEAN DEFAULT false;

UPDATE email_messages SET is_bounce = true
WHERE (from_address ILIKE 'mailer-daemon@%' OR from_address ILIKE 'postmaster@%')
   OR subject ILIKE '%undelivered mail%'
   OR subject ILIKE '%delivery status notification%';

CREATE INDEX IF NOT EXISTS idx_email_messages_not_bounce
  ON email_messages (direction, created_at DESC) WHERE is_bounce = false;

-- DOWN
-- DROP INDEX IF EXISTS idx_email_messages_not_bounce;
-- ALTER TABLE email_messages DROP COLUMN IF EXISTS is_bounce;
