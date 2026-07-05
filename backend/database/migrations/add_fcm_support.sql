-- Миграция: FCM push для мобильного приложения (Flutter)
-- + user_id для привязки чат-сессий к аккаунту

-- ========================================
-- 1. FCM поддержка в push-подписках
-- ========================================

-- Добавляем platform (web/android/ios)
ALTER TABLE visitor_push_subscriptions
  ADD COLUMN IF NOT EXISTS platform VARCHAR(10) DEFAULT 'web';

-- Добавляем FCM-токен для мобильных подписок
ALTER TABLE visitor_push_subscriptions
  ADD COLUMN IF NOT EXISTS fcm_token TEXT;

-- Делаем endpoint nullable (для FCM подписок endpoint не нужен)
ALTER TABLE visitor_push_subscriptions
  ALTER COLUMN endpoint DROP NOT NULL;

-- Делаем keys nullable (для FCM подписок keys не нужны)
ALTER TABLE visitor_push_subscriptions
  ALTER COLUMN keys DROP NOT NULL;

-- Индекс для FCM-токенов
CREATE INDEX IF NOT EXISTS idx_visitor_push_fcm_token ON visitor_push_subscriptions(fcm_token)
  WHERE fcm_token IS NOT NULL;

-- Индекс для platform
CREATE INDEX IF NOT EXISTS idx_visitor_push_platform ON visitor_push_subscriptions(platform);

-- Уникальность для FCM: одна подписка на session + fcm_token
CREATE UNIQUE INDEX IF NOT EXISTS idx_visitor_push_session_fcm
  ON visitor_push_subscriptions(session_id, fcm_token)
  WHERE fcm_token IS NOT NULL;

-- ========================================
-- 2. user_id для привязки сессий к аккаунту
-- ========================================

-- Добавляем user_id в чат-сессии (для связки сайт ↔ приложение)
ALTER TABLE visitor_chat_sessions
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- Индекс для поиска сессий по user_id
CREATE INDEX IF NOT EXISTS idx_visitor_sessions_user_id ON visitor_chat_sessions(user_id)
  WHERE user_id IS NOT NULL;
