-- Migration: 20260530_client_service_attributions
-- Team mapping-telegram-services — slice S1 (owner: impl-migration).
-- Назначение: атрибуция услуг клиентов по каналам (Telegram и др.) в нормализованной
-- таблице client_service_attributions + денорм-кэш на contacts (primary_service_*).
-- Цель: каждый TG-контакт получает заполненное поле «какую услугу заказывал».
--
-- Источник истины: 30-architecture.md §Final data model + АВТОРИТЕТНАЯ секция «Review responses (Phase 3)».
-- Отличия от первичного DDL (по ревью):
--   * method CHECK без 'none' (sentinel живёт только в денорм-кэше contacts, P0-1).
--   * service_slug / service_category — свободные varchar, БЕЗ FK на service_catalog (P1-5).
--   * НЕ создаём низкоселективные idx_csa_tier / idx_contacts_attr_tier (P2-nit).
--
-- Идемпотентна (IF NOT EXISTS / DO-guard на CHECK-констрейнты). Повторный прогон без ошибок.
-- БД общая dev/prod — применяется один раз. gen_random_uuid() встроена в PG17 (pgcrypto не требуется).

BEGIN;

-- ============================================================================
-- Слой 1 — источник истины: client_service_attributions (NEW)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.client_service_attributions (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id       uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
    channel          character varying(20) NOT NULL,        -- 'telegram'|'vk'|'max'|'whatsapp'|'web'|'email'
    service_slug     character varying(100) NOT NULL,       -- нормализованный slug (свободный varchar, без FK)
    service_label    character varying(255),                -- исходный free-text (аудит), усекается до 255
    service_category character varying(50),                 -- грубая категория
    method           character varying(24) NOT NULL
                       CHECK (method IN ('order','receipt','subscription','booking',
                                         'conversation','text_inference','manual')),
    tier             character varying(12) NOT NULL
                       CHECK (tier IN ('fact','inferred','none')),
    confidence       numeric(4,3) NOT NULL DEFAULT 1.000
                       CHECK (confidence >= 0 AND confidence <= 1),
    source_table     character varying(40),
    source_id        uuid,
    determined_at    timestamp with time zone NOT NULL DEFAULT now(),
    created_at       timestamp with time zone NOT NULL DEFAULT now(),
    updated_at       timestamp with time zone NOT NULL DEFAULT now()
);

-- Идемпотентный upsert-ключ (P0-1): одна строка на (source_table, source_id, service_slug)
-- для записей с провенансом. Покрывает и fact, и inferred (у обоих source_id NOT NULL).
CREATE UNIQUE INDEX IF NOT EXISTS ux_csa_source_service
    ON public.client_service_attributions (source_table, source_id, service_slug)
    WHERE source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_csa_contact
    ON public.client_service_attributions (contact_id, determined_at DESC);

CREATE INDEX IF NOT EXISTS idx_csa_channel_service
    ON public.client_service_attributions (channel, service_slug);

-- ============================================================================
-- Слой 2 — денорм-кэш на contacts (NEW колонки)
-- ============================================================================
ALTER TABLE public.contacts
    ADD COLUMN IF NOT EXISTS primary_service_slug     character varying(100),
    ADD COLUMN IF NOT EXISTS primary_service_label    character varying(255),
    ADD COLUMN IF NOT EXISTS service_attribution_tier character varying(12) DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS service_attributed_at    timestamp with time zone;

-- CHECK на tier-кэш через DO-guard (ADD COLUMN ... CHECK не идемпотентен при повторе).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'contacts_service_attribution_tier_check'
          AND conrelid = 'public.contacts'::regclass
    ) THEN
        ALTER TABLE public.contacts
            ADD CONSTRAINT contacts_service_attribution_tier_check
            CHECK (service_attribution_tier IN ('fact','inferred','none'));
    END IF;
END $$;

-- DEFAULT 'none' красит все существующие строки → поле НЕ-NULL у 100% контактов сразу.
CREATE INDEX IF NOT EXISTS idx_contacts_primary_service
    ON public.contacts (primary_service_slug)
    WHERE primary_service_slug IS NOT NULL;

COMMIT;
