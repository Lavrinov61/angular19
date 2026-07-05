-- Email v3: starred messages
ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS is_starred boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_email_messages_starred ON email_messages (is_starred) WHERE is_starred = true;
