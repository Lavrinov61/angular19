-- MAX broadcast engine — расширение модели данных под канал 'max'.
-- Идемпотентна (DROP IF EXISTS + ADD; UPDATE по конкретному id). Применяется один раз к общей БД dev+prod.
BEGIN;

-- A: разрешить channel='max' в marketing_campaigns.
--    ВАЖНО: параллельно разрабатывается канал 'vk' (zz_20260601_vk_broadcast.sql), который
--    бьёт этот же именованный CHECK. Чтобы миграции не затирали каналы друг друга при ЛЮБОМ
--    порядке применения, ОБА файла держат ПОЛНЫЙ набор каналов проекта (telegram, vk, max).
ALTER TABLE marketing_campaigns DROP CONSTRAINT IF EXISTS marketing_campaigns_channel_check;
ALTER TABLE marketing_campaigns ADD CONSTRAINT marketing_campaigns_channel_check
  CHECK (channel IN ('print','digital','mixed','telegram','vk','max'));

-- B: синхронизировать capability с рантаймом (inline-кнопки реально работают)
UPDATE channel_accounts SET capabilities = capabilities || '{"sendInlineButton": true}'::jsonb
WHERE id = '736923b0-4fc1-4027-ba69-071aaef892b3' AND channel = 'max';

COMMIT;
