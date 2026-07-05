-- Добавляем 'internal_note' в допустимые значения sender_type для visitor_chat_messages
-- Заметки видны только операторам, клиент их не видит

ALTER TABLE visitor_chat_messages
  DROP CONSTRAINT IF EXISTS visitor_chat_messages_sender_type_check;

ALTER TABLE visitor_chat_messages
  ADD CONSTRAINT visitor_chat_messages_sender_type_check
  CHECK (sender_type IN ('visitor', 'operator', 'bot', 'internal_note'));
