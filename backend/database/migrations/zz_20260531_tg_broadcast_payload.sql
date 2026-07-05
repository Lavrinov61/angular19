-- zz_20260531_tg_broadcast_payload.sql
-- Follow-up к zz_20260531_tg_broadcast.sql (S0.1).
-- Контент рассылки {text, mediaUrl, buttons:[[{text,url}]]} для кампании —
-- выделенная колонка вместо перегрузки notes. Аддитивно, nullable, CRM не задевается.
-- Идемпотентно (БД общая dev/prod): ADD COLUMN IF NOT EXISTS.

ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS broadcast_payload JSONB NULL;
