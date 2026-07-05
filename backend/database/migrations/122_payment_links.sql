-- Migration 122: payment_links — отдельная таблица для платёжных ссылок (CRM создаёт ссылку, заказ создаётся ПОСЛЕ оплаты)
-- Идемпотентна (IF NOT EXISTS)

BEGIN;

CREATE TABLE IF NOT EXISTS public.payment_links (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_ref         varchar(40)  NOT NULL UNIQUE,
  amount            numeric(10,2) NOT NULL CHECK (amount > 0),
  currency          varchar(3)   NOT NULL DEFAULT 'RUB',
  services          jsonb        NOT NULL DEFAULT '[]'::jsonb,
  description       text,
  conversation_id   uuid         REFERENCES public.conversations(id) ON DELETE SET NULL,
  contact_phone     varchar(32),
  contact_name      varchar(255),
  contact_email     varchar(255),
  created_by        uuid         REFERENCES public.users(id) ON DELETE SET NULL,
  status            varchar(16)  NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','paid','cancelled','expired')),
  payment_id        varchar(64),
  payment_method    varchar(24),
  payment_card_info varchar(48),
  paid_at           timestamptz,
  expires_at        timestamptz  NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  order_ref_linked  varchar(40),
  metadata          jsonb        NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz  NOT NULL DEFAULT NOW(),
  updated_at        timestamptz  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_links_conversation
  ON public.payment_links (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_links_expiry
  ON public.payment_links (expires_at) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_payment_links_order_ref
  ON public.payment_links (order_ref);

CREATE INDEX IF NOT EXISTS idx_payment_links_payment_id
  ON public.payment_links (payment_id) WHERE payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_links_created_by
  ON public.payment_links (created_by, created_at DESC);

COMMIT;
