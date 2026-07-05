-- Миграция: Добавляет metadata JSONB колонку в visitor_chat_sessions
-- Используется для хранения данных о заказе, доставке, шагах оформления

-- Колонка metadata для сессий (хранит pendingOrder, delivery, orderNumber и т.д.)
ALTER TABLE visitor_chat_sessions 
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Колонка metadata для сообщений (хранит interactive bot data)
ALTER TABLE visitor_chat_messages 
  ADD COLUMN IF NOT EXISTS metadata JSONB;

-- Расширяем допустимые message_type для interactive сообщений бота
-- PostgreSQL не поддерживает ALTER CHECK inline, поэтому:
ALTER TABLE visitor_chat_messages 
  DROP CONSTRAINT IF EXISTS visitor_chat_messages_message_type_check;
ALTER TABLE visitor_chat_messages 
  ADD CONSTRAINT visitor_chat_messages_message_type_check 
  CHECK (message_type IN ('text', 'image', 'file', 'system', 'interactive'));
