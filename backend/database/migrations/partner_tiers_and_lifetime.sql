-- =============================================================================
-- partner_tiers_and_lifetime.sql
-- =============================================================================
-- Тиерная партнёрская программа с lifetime commission.
--
-- Структура:
--   partner_tiers — 6 уровней (Старт→Стратегический) с комиссиями и скидками
--   partners.tier_slug — текущий тир партнёра
--   partners.monthly_revenue — оборот за последние 30 дней (обновляется cron)
--   partner_referrals.commission_type — first | repeat | lifetime
--   partner_referrals.client_order_count — порядковый # заказа клиента у партнёра
--
-- Экономика (Профессиональный 890₽, партнёр ТОП):
--   1-й заказ клиента: 35% = 311₽
--   2-5-й: 20% = 178₽ × 4 = 712₽
--   6+: 15% = 133₽ × N
--   LTV от одного клиента: ~2 500₽+
-- =============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- Таблица тиров
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS partner_tiers (
  id                         SERIAL PRIMARY KEY,
  slug                       VARCHAR(50)    NOT NULL UNIQUE,
  name                       VARCHAR(100)   NOT NULL,
  description                TEXT,
  -- Минимальный месячный оборот рефералов для достижения тира (0 = любой)
  min_monthly_revenue        DECIMAL(12,2)  NOT NULL DEFAULT 0,
  -- Комиссия с первого заказа привлечённого клиента
  commission_first_percent   DECIMAL(5,2)   NOT NULL,
  -- Комиссия со 2-го по 5-й заказ того же клиента
  commission_repeat_percent  DECIMAL(5,2)   NOT NULL,
  -- Комиссия с 6-го+ заказа ("пожизненный" доход)
  commission_lifetime_percent DECIMAL(5,2)  NOT NULL,
  -- Скидка, которую получает клиент при использовании промокода партнёра
  client_discount_percent    DECIMAL(5,2)   NOT NULL DEFAULT 0,
  -- Срок жизни куки/атрибуции (дни)
  cookie_ttl_days            INTEGER        NOT NULL DEFAULT 30,
  -- Нельзя получить автоматически — только ручное назначение
  is_manual_only             BOOLEAN        NOT NULL DEFAULT FALSE,
  -- Защита от резкого понижения: num месяцев ниже порога → только тогда понижение
  downgrade_grace_months     INTEGER        NOT NULL DEFAULT 2,
  sort_order                 INTEGER        NOT NULL DEFAULT 0,
  created_at                 TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- Seed: 6 тиров (Старт → Стратегический)
INSERT INTO partner_tiers (
  slug, name, description,
  min_monthly_revenue,
  commission_first_percent, commission_repeat_percent, commission_lifetime_percent,
  client_discount_percent, cookie_ttl_days, is_manual_only, sort_order
) VALUES
  ('start',      'Старт',          'Любой новый партнёр',
   0,       15, 10,  5,  5,  30,  false, 1),
  ('active',     'Активный',       'Стабильный поток клиентов',
   15000,   20, 12,  7,  5,  60,  false, 2),
  ('advanced',   'Продвинутый',    'Серьёзный партнёрский трафик',
   50000,   25, 15, 10,  7,  90,  false, 3),
  ('expert',     'Эксперт',        'Высокий ежемесячный объём',
   150000,  30, 18, 12, 10, 120,  false, 4),
  ('top',        'ТОП',            'Один из лучших партнёров',
   500000,  35, 20, 15, 10, 180,  false, 5),
  ('strategic',  'Стратегический', 'Индивидуальные условия — только ручное назначение',
   0,       40, 25, 15, 15, 365,  true,  6)
ON CONFLICT (slug) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────
-- Расширение таблицы partners
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE partners
  ADD COLUMN IF NOT EXISTS tier_slug VARCHAR(50) NOT NULL DEFAULT 'start'
    REFERENCES partner_tiers(slug),
  ADD COLUMN IF NOT EXISTS tier_updated_at TIMESTAMPTZ,
  -- Кэшированный оборот за скользящие 30 дней (обновляет cron)
  ADD COLUMN IF NOT EXISTS monthly_revenue DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS monthly_revenue_at TIMESTAMPTZ,
  -- Счётчик «понижающих» месяцев (grace period для downgrade)
  ADD COLUMN IF NOT EXISTS downgrade_months_count INTEGER NOT NULL DEFAULT 0;

-- ────────────────────────────────────────────────────────────────────────────
-- Расширение таблицы partner_referrals
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE partner_referrals
  -- Тип комиссии по lifetime-схеме
  ADD COLUMN IF NOT EXISTS commission_type VARCHAR(20) NOT NULL DEFAULT 'first'
    CHECK (commission_type IN ('first', 'repeat', 'lifetime')),
  -- Порядковый номер заказа данного клиента у данного партнёра
  ADD COLUMN IF NOT EXISTS client_order_count INTEGER NOT NULL DEFAULT 1;

-- ────────────────────────────────────────────────────────────────────────────
-- Индексы
-- ────────────────────────────────────────────────────────────────────────────

-- Быстрый подсчёт оборота за 30 дней по партнёру
CREATE INDEX IF NOT EXISTS idx_partner_referrals_partner_created
  ON partner_referrals(partner_id, created_at DESC);

-- Подсчёт заказов клиента у конкретного партнёра (для commission_type)
CREATE INDEX IF NOT EXISTS idx_partner_referrals_partner_phone
  ON partner_referrals(partner_id, client_phone);

COMMIT;
