-- Migration: F83 offline_auto_reply — template + throttle column
-- Idempotent: IF NOT EXISTS / ON CONFLICT DO NOTHING

-- 1. Add throttle flag to conversations (prevents spam: 1 auto-reply per conversation)
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS auto_reply_sent BOOLEAN DEFAULT false;

-- 2. Insert offline auto-reply template
INSERT INTO bot_message_templates (event_type, content, description)
VALUES (
  'offline_auto_reply',
  'Здравствуйте, {client_name}! Сейчас все операторы заняты. Мы ответим вам в ближайшее время. Наши часы работы: Пн–Вс 09:00–19:30.',
  'Автоответ когда все операторы офлайн'
)
ON CONFLICT (event_type) DO NOTHING;
