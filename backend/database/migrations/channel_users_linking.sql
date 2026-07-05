-- Расширение channel_users для привязки к ЛК пользователя
-- Позволяет клиенту связать мессенджер-аккаунты со своим личным кабинетом

ALTER TABLE channel_users
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS linked_by VARCHAR(20) DEFAULT 'auto';

-- Индекс для быстрого lookup привязок по user_id
CREATE INDEX IF NOT EXISTS idx_channel_users_user_id
  ON channel_users(user_id) WHERE user_id IS NOT NULL;

-- Один user → один аккаунт в канале (нельзя привязать два telegram к одному ЛК)
CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_users_user_channel
  ON channel_users(user_id, channel) WHERE user_id IS NOT NULL;

-- Backfill: пробросить user_id из contacts (через contact_id → contacts.user_id)
UPDATE channel_users cu
SET user_id = c.user_id, linked_by = 'auto'
FROM contacts c
WHERE cu.contact_id = c.id
  AND c.user_id IS NOT NULL
  AND cu.user_id IS NULL;

-- Backfill: привязать VK OAuth юзеров (users.vk_id → channel_users.external_user_id)
UPDATE channel_users cu
SET user_id = u.id, verified_at = NOW(), linked_by = 'oauth'
FROM users u
WHERE cu.channel = 'vk'
  AND cu.external_user_id = u.vk_id
  AND u.vk_id IS NOT NULL
  AND cu.user_id IS NULL;

-- Backfill: привязать Telegram юзеров (users.telegram_id → channel_users.external_user_id)
UPDATE channel_users cu
SET user_id = u.id, verified_at = NOW(), linked_by = 'auto'
FROM users u
WHERE cu.channel = 'telegram'
  AND cu.external_user_id = u.telegram_id
  AND u.telegram_id IS NOT NULL
  AND cu.user_id IS NULL;
