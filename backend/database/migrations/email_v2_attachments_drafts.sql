-- Email v2: Allow orphan attachments (upload before draft), add uploaded_by tracking
-- Idempotent migration

-- 1. Make email_id nullable so attachments can be uploaded before linking to an email
ALTER TABLE email_attachments ALTER COLUMN email_id DROP NOT NULL;

-- 2. Add uploaded_by to track who uploaded the attachment
ALTER TABLE email_attachments ADD COLUMN IF NOT EXISTS uploaded_by uuid REFERENCES users(id);

-- 3. Index for orphan attachment cleanup
CREATE INDEX IF NOT EXISTS idx_email_attachments_orphan
  ON email_attachments (created_at) WHERE email_id IS NULL;

-- 4. Index for draft listing
CREATE INDEX IF NOT EXISTS idx_email_messages_drafts
  ON email_messages (sent_by, created_at DESC) WHERE status = 'draft';
