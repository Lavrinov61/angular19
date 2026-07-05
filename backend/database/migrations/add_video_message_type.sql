-- Миграция: добавить тип 'video' в CHECK constraint для message_type

ALTER TABLE visitor_chat_messages
  DROP CONSTRAINT IF EXISTS visitor_chat_messages_message_type_check;

ALTER TABLE visitor_chat_messages
  ADD CONSTRAINT visitor_chat_messages_message_type_check
  CHECK (message_type IN ('text', 'image', 'file', 'video', 'system', 'interactive'));
