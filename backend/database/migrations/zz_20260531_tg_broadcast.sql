-- zz_20260531_tg_broadcast.sql
-- Telegram-рассылка через @FmagnusBot (Слайс S0).
-- Архитектура: TG_BROADCAST_ARCHITECTURE_2026_05_31.md §3.2-3.4.
-- Идемпотентно (БД общая dev/prod): DROP CONSTRAINT IF EXISTS + ADD, ADD COLUMN IF NOT EXISTS,
-- CREATE TABLE/INDEX IF NOT EXISTS. Аддитивно. privacy_consents НЕ трогаем
-- (document_type CHECK = <> '', 'marketing_telegram' проходит без ALTER).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. marketing_campaigns: расширить CHECK (P0-2) — иначе TG-кампанию не вставить
-- ---------------------------------------------------------------------------
ALTER TABLE marketing_campaigns DROP CONSTRAINT IF EXISTS marketing_campaigns_campaign_type_check;
ALTER TABLE marketing_campaigns ADD  CONSTRAINT marketing_campaigns_campaign_type_check
  CHECK (campaign_type IN ('flyer','email','sms','social','paid_ads','partner','messenger'));

ALTER TABLE marketing_campaigns DROP CONSTRAINT IF EXISTS marketing_campaigns_channel_check;
ALTER TABLE marketing_campaigns ADD  CONSTRAINT marketing_campaigns_channel_check
  CHECK (channel IN ('print','digital','mixed','telegram'));

-- ---------------------------------------------------------------------------
-- 2. marketing_campaigns: тест-гейт «только flavrinov» в ДАННЫХ (аудируемо)
--    Kill-switch — переиспользуем существующий status (active/paused/cancelled), не плодим enum.
-- ---------------------------------------------------------------------------
ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS test_mode BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS allowed_contact_ids UUID[] NULL;

-- ---------------------------------------------------------------------------
-- 3. campaign_recipients — durable-реестр (outbox) «кому что отправили» (§3.3)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campaign_recipients (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id         UUID NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  contact_id          UUID NOT NULL REFERENCES contacts(id),
  channel             TEXT NOT NULL,                       -- 'telegram'
  external_chat_id    TEXT NOT NULL,                       -- денормализуем детерминированно (§4.2)
  kind                TEXT NOT NULL DEFAULT 'marketing'
                        CHECK (kind IN ('marketing','transactional')),

  idempotency_key     TEXT NOT NULL,                       -- 'camp:'||campaign_id||':'||contact_id

  status              TEXT NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued','sent','failed','blocked','skipped','suppressed')),
  skip_reason         TEXT NULL,                           -- 'frequency_cap'|'no_consent'|'no_chat'|'quiet_hours'

  personalized_url    TEXT NULL,                           -- utm_source/medium/campaign + utm_content=contact_id + campaign_id
  payload_snapshot    JSONB NULL,                          -- {text, mediaUrl, button:{label,url}}

  attempts            INT NOT NULL DEFAULT 0,
  max_attempts        INT NOT NULL DEFAULT 3,
  next_attempt_at     TIMESTAMPTZ NULL,

  external_message_id TEXT NULL,                           -- 'tg:<message_id>'
  error_code          TEXT NULL,
  error_detail        TEXT NULL,

  queued_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at             TIMESTAMPTZ NULL,
  failed_at           TIMESTAMPTZ NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_recipient_per_campaign UNIQUE (campaign_id, contact_id),
  CONSTRAINT uq_recipient_idem         UNIQUE (idempotency_key)
);

-- Диспетчер: выборка отправляемых строк (queued/failed) по next_attempt_at
CREATE INDEX IF NOT EXISTS idx_recipients_dispatchable
  ON campaign_recipients (next_attempt_at) WHERE status IN ('queued','failed');

-- Частотный кап: только маркетинг, только реально отправленные
CREATE INDEX IF NOT EXISTS idx_recipients_freqcap
  ON campaign_recipients (contact_id, sent_at) WHERE kind = 'marketing' AND sent_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. marketing_suppressions — net-new (§3.4). 152-ФЗ: переживает erasure ПД.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketing_suppressions (
  contact_id       UUID NULL REFERENCES contacts(id),
  external_chat_id TEXT NULL,                              -- если chatId не резолвится в contact
  reason           TEXT NOT NULL CHECK (reason IN ('unsubscribe','hard_bounce','complaint','manual')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_suppression_contact
  ON marketing_suppressions (contact_id) WHERE contact_id IS NOT NULL;

COMMIT;
