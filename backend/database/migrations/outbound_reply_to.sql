-- Outbound reply-to support
-- Adds reply_to_external_id column for quoting specific messages in outbound delivery
-- Idempotent: IF NOT EXISTS

ALTER TABLE outbound_queue
  ADD COLUMN IF NOT EXISTS reply_to_external_id TEXT;

COMMENT ON COLUMN outbound_queue.reply_to_external_id
  IS 'External message ID of the message being replied to (e.g. tg:123, vk:456, wamid.xxx)';

\echo '✅ outbound_queue.reply_to_external_id column added'
