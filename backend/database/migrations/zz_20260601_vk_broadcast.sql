-- VK-рассылка: расширение channel CHECK + индекс канала + анти-дубль по peer
-- Идемпотентная миграция: безопасна для повторного запуска
BEGIN;

-- 1. Расширяем CHECK-констрейнт marketing_campaigns: добавляем 'vk' (и 'max' — см. ниже).
--    Имя подтверждено: marketing_campaigns_channel_check.
--    ВАЖНО: параллельно разрабатывается канал 'max' (zz_20260601_max_broadcast.sql), который
--    тоже DROP+ADD этого же CHECK. Чтобы миграции не затирали каналы друг друга при любом
--    порядке применения, ОБЕ должны держать ПОЛНЫЙ набор каналов проекта. Поэтому здесь 'vk'+'max'.
ALTER TABLE marketing_campaigns DROP CONSTRAINT IF EXISTS marketing_campaigns_channel_check;
ALTER TABLE marketing_campaigns ADD CONSTRAINT marketing_campaigns_channel_check
  CHECK (channel IN ('print','digital','mixed','telegram','vk','max'));

-- 2. Индекс по channel для быстрого dispatch WHERE channel='vk' / channel='telegram'
CREATE INDEX IF NOT EXISTS idx_mc_channel ON marketing_campaigns(channel);

-- 3. Partial unique index: один VK peer_id получает ровно одну строку в campaign_recipients
--    (P0-1: один peer = несколько contact_id, дубль = спам-сигнал, риск бана группы VK)
--    ON CONFLICT DO NOTHING в materializeRecipients для VK соблюдает этот барьер.
CREATE UNIQUE INDEX IF NOT EXISTS uq_recipient_vk_peer
  ON campaign_recipients (campaign_id, external_chat_id)
  WHERE channel = 'vk';

COMMIT;
