-- Email attachments storage (Phase 2 of Email MIME Parsing Fix)
CREATE TABLE IF NOT EXISTS email_attachments (
  id SERIAL PRIMARY KEY,
  email_id INTEGER NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
  crm_file_id INTEGER REFERENCES crm_files(id) ON DELETE SET NULL,
  filename VARCHAR(500) NOT NULL,
  mime_type VARCHAR(100),
  size_bytes BIGINT,
  content_id VARCHAR(200),           -- cid for inline images
  content_disposition VARCHAR(20) DEFAULT 'attachment',
  s3_key TEXT,
  storage_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_attachments_email ON email_attachments(email_id);
CREATE INDEX IF NOT EXISTS idx_email_attachments_cid ON email_attachments(content_id) WHERE content_id IS NOT NULL;

ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS raw_source_key TEXT;
