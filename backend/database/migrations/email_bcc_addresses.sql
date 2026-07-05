-- Add bcc_addresses column to email_messages for CC/BCC support
ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS bcc_addresses text[];
