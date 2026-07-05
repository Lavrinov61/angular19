-- Message Outbox Idempotency: client_message_id for deduplication
-- Allows clients to safely retry message sends without duplicates

ALTER TABLE visitor_chat_messages
  ADD COLUMN IF NOT EXISTS client_message_id VARCHAR(36);

-- Unique index for idempotency: only one message per client_message_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_vcm_client_message_id
  ON visitor_chat_messages (client_message_id)
  WHERE client_message_id IS NOT NULL;
