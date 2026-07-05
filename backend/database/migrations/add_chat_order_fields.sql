-- Миграция: chat_session_id для связи заказов из чата с сессиями

ALTER TABLE photo_print_orders
  ADD COLUMN IF NOT EXISTS chat_session_id UUID;

CREATE INDEX IF NOT EXISTS idx_photo_print_orders_chat_session
  ON photo_print_orders(chat_session_id)
  WHERE chat_session_id IS NOT NULL;
