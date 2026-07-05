-- Forward/reply support for omnichannel messages (Telegram, VK)
-- 2026-03-03

ALTER TABLE visitor_chat_messages
  ADD COLUMN IF NOT EXISTS reply_to_message_id UUID REFERENCES visitor_chat_messages(id),
  ADD COLUMN IF NOT EXISTS is_forwarded BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS forwarded_from_name VARCHAR(200);

-- Index for reply lookups
CREATE INDEX IF NOT EXISTS idx_vcm_reply_to ON visitor_chat_messages (reply_to_message_id) WHERE reply_to_message_id IS NOT NULL;
