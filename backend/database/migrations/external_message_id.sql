-- Добавляем external_message_id для дедупликации сообщений из внешних каналов
-- (WhatsApp message ID от Meta, VK event_id и т.д.)

ALTER TABLE visitor_chat_messages
  ADD COLUMN IF NOT EXISTS external_message_id VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vcm_external_message_id
  ON visitor_chat_messages(external_message_id)
  WHERE external_message_id IS NOT NULL;
