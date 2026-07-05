-- 20260530_subscription_card_change.sql
-- Self-service смена карты подписчика (CloudPayments): кэш текущей карты в user_subscriptions,
-- guard-флаг против гонки Cancelled-вебхука + UNIQUE «один активный CP-рекуррент на запись»,
-- state-machine таблица subscription_card_changes (init→swap→pending_cancel_old→completed/failed).
-- Идемпотентна (IF NOT EXISTS / DO-блоки). Shared dev/prod БД — применяется сразу (CLAUDE.md).
-- PRE-FLIGHT перед UNIQUE uq_user_subs_active_cp (дубли cp_subscription_id) проверен — пусто.

BEGIN;

-- 1) Кэш текущей карты + guard-флаг смены на user_subscriptions.
--    card_change_in_progress защищает от гонки: при отмене старого рекуррента CP шлёт
--    /recurrent Cancelled с Id=OLD, lookup матчит по AccountId (=наш subscription_id) →
--    swap cpId не прячет запись; guard не даёт отменить активную подписку.
ALTER TABLE public.user_subscriptions
  ADD COLUMN IF NOT EXISTS card_last_four          character varying(4),
  ADD COLUMN IF NOT EXISTS card_type               character varying(20),
  ADD COLUMN IF NOT EXISTS card_change_in_progress boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS card_change_started_at  timestamp with time zone;

-- 2) Гард «один активный CP-рекуррент на запись» — не допускает два активных рекуррента
--    (нет двойного списания). Partial: только active/paused с непустым cp_subscription_id.
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_subs_active_cp
  ON public.user_subscriptions (cloudpayments_subscription_id)
  WHERE cloudpayments_subscription_id IS NOT NULL
    AND status IN ('active', 'paused');

-- 3) State-machine смены карты. new_cp_token хранится здесь (а не в Redis) — нужен
--    reconciler'у после рестарта процесса. PCI: токен ≠ PAN, в логах обрезается.
CREATE TABLE IF NOT EXISTS public.subscription_card_changes (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id         uuid NOT NULL REFERENCES public.user_subscriptions(id) ON DELETE CASCADE,
  user_id                 uuid REFERENCES public.users(id),
  idempotency_key         character varying(64) NOT NULL,
  status                  character varying(24) NOT NULL DEFAULT 'awaiting_token',
  old_cp_subscription_id  character varying(100),
  old_cp_token            character varying(255),
  new_cp_subscription_id  character varying(100),
  new_cp_token            character varying(255),
  new_card_last_four      character varying(4),
  new_card_type           character varying(20),
  expected_amount         numeric(10,2) NOT NULL,
  verify_transaction_id   bigint,
  cancel_attempts         integer NOT NULL DEFAULT 0,
  refunded                boolean NOT NULL DEFAULT false,
  last_error              text,
  created_at              timestamp with time zone NOT NULL DEFAULT now(),
  updated_at              timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT scc_status_check CHECK (status IN ('awaiting_token', 'swapping', 'pending_cancel_old', 'completed', 'failed'))
);

-- Идемпотентность init/confirm/вебхуков (один change на idempotency_key).
CREATE UNIQUE INDEX IF NOT EXISTS uq_scc_idem
  ON public.subscription_card_changes (idempotency_key);

-- Не более одной открытой смены на подписку (повторный init вернёт ту же строку).
CREATE UNIQUE INDEX IF NOT EXISTS uq_scc_open_per_sub
  ON public.subscription_card_changes (subscription_id)
  WHERE status IN ('awaiting_token', 'swapping', 'pending_cancel_old');

-- Выборка для reconciler (незавершённые смены, по давности).
CREATE INDEX IF NOT EXISTS idx_scc_active
  ON public.subscription_card_changes (status, updated_at)
  WHERE status IN ('awaiting_token', 'swapping', 'pending_cancel_old');

COMMENT ON COLUMN public.user_subscriptions.card_last_four IS
  'Последние 4 цифры карты текущего рекуррента (из /pay-вебхука CloudPayments). Кэш для UI «•••• last4».';
COMMENT ON COLUMN public.user_subscriptions.card_type IS
  'Тип карты текущего рекуррента (Visa/MasterCard/МИР) из /pay-вебхука CloudPayments.';
COMMENT ON COLUMN public.user_subscriptions.card_change_in_progress IS
  'Guard смены карты: пока true — /recurrent Cancelled старого рекуррента игнорируется (не отменяет подписку).';
COMMENT ON COLUMN public.user_subscriptions.card_change_started_at IS
  'Момент старта guard-флага; reconciler сбрасывает зависший флаг по давности (>30 мин без активной смены).';

COMMENT ON TABLE public.subscription_card_changes IS
  'State-machine self-service смены карты подписки CloudPayments (1₽-verify → /subscriptions/create на новой карте → swap → cancel старого рекуррента). Reconciler дочищает pending_cancel_old/orphan.';
COMMENT ON COLUMN public.subscription_card_changes.idempotency_key IS
  'changeId смены; externalId платежа = SUBCC-<key>. Уникален — защита от дублей init/вебхуков.';
COMMENT ON COLUMN public.subscription_card_changes.new_cp_token IS
  'Токен новой карты (из /pay-вебхука 1₽-verify). PCI: токен ≠ PAN, в логах обрезать. Нужен reconciler после рестарта.';
COMMENT ON COLUMN public.subscription_card_changes.expected_amount IS
  'Ожидаемая сумма 1₽-верификации для anti-tamper в /check и payments/find (±0.01, RUB).';

COMMIT;
