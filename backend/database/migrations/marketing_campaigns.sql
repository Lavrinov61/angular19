-- =============================================================================
-- Маркетинговые кампании: таблицы для трекинга флайеров, промокодов, конверсий
-- Создано: 2026-03-15
-- Идемпотентная миграция (IF NOT EXISTS)
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. marketing_campaigns — основная таблица кампаний
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketing_campaigns (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                  VARCHAR(255) NOT NULL,
    description           TEXT,
    campaign_type         VARCHAR(30) NOT NULL
        CHECK (campaign_type IN ('flyer', 'email', 'sms', 'social', 'paid_ads', 'partner')),
    channel               VARCHAR(30)
        CHECK (channel IN ('print', 'digital', 'mixed')),
    status                VARCHAR(20) DEFAULT 'draft'
        CHECK (status IN ('draft', 'active', 'paused', 'completed', 'cancelled')),
    budget                NUMERIC(10,2),
    spent                 NUMERIC(10,2) DEFAULT 0,
    start_date            TIMESTAMPTZ,
    end_date              TIMESTAMPTZ,
    utm_source            VARCHAR(100),
    utm_campaign          VARCHAR(100),
    utm_medium            VARCHAR(50),
    target_location       VARCHAR(255),       -- 'Соборный 21' для флайеров
    target_audience       TEXT,                -- описание ЦА
    print_quantity        INTEGER,             -- кол-во напечатанных флайеров
    distributed_quantity  INTEGER DEFAULT 0,   -- кол-во розданных
    notes                 TEXT,
    created_by            UUID REFERENCES users(id),
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    updated_at            TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE marketing_campaigns IS 'Маркетинговые кампании (флайеры, email, SMS, соцсети, реклама, партнёры)';
COMMENT ON COLUMN marketing_campaigns.campaign_type IS 'Тип: flyer | email | sms | social | paid_ads | partner';
COMMENT ON COLUMN marketing_campaigns.channel IS 'Канал распространения: print | digital | mixed';
COMMENT ON COLUMN marketing_campaigns.target_location IS 'Локация раздачи (для флайеров — адрес/район)';
COMMENT ON COLUMN marketing_campaigns.print_quantity IS 'Кол-во напечатанных материалов (флайеры, визитки)';
COMMENT ON COLUMN marketing_campaigns.distributed_quantity IS 'Кол-во розданных/распространённых материалов';

-- Индексы marketing_campaigns
CREATE INDEX IF NOT EXISTS idx_mc_status
    ON marketing_campaigns(status);

CREATE INDEX IF NOT EXISTS idx_mc_campaign_type
    ON marketing_campaigns(campaign_type);

CREATE INDEX IF NOT EXISTS idx_mc_dates
    ON marketing_campaigns(start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_mc_created_at
    ON marketing_campaigns(created_at DESC);

-- ---------------------------------------------------------------------------
-- 2. campaign_promo_codes — связь кампания <-> промокод (M:N)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campaign_promo_codes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id     UUID NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
    promotion_id    UUID NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE campaign_promo_codes IS 'Связь маркетинговых кампаний с промоакциями (M:N)';

-- Уникальность пары кампания-промоакция
CREATE UNIQUE INDEX IF NOT EXISTS idx_cpc_campaign_promotion
    ON campaign_promo_codes(campaign_id, promotion_id);

-- ---------------------------------------------------------------------------
-- 3. promo_redemptions — журнал каждого применения промокода
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS promo_redemptions (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    promotion_id      UUID NOT NULL REFERENCES promotions(id),
    campaign_id       UUID REFERENCES marketing_campaigns(id),
    order_id          UUID,                   -- ссылка на заказ (не FK — разные таблицы заказов)
    order_type        VARCHAR(30),            -- 'photo_print' | 'booking' | 'pos_receipt'
    customer_id       UUID REFERENCES customers(id),
    customer_phone    VARCHAR(20),
    promo_code        VARCHAR(50) NOT NULL,
    discount_amount   NUMERIC(10,2) NOT NULL,
    original_amount   NUMERIC(10,2),
    status            VARCHAR(20) DEFAULT 'applied'
        CHECK (status IN ('applied', 'reversed')),
    redeemed_at       TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE promo_redemptions IS 'Журнал применений промокодов с привязкой к кампаниям и заказам';
COMMENT ON COLUMN promo_redemptions.order_id IS 'ID заказа (не FK — может ссылаться на разные таблицы)';
COMMENT ON COLUMN promo_redemptions.order_type IS 'Тип заказа: photo_print | booking | pos_receipt';

-- Индексы promo_redemptions
CREATE INDEX IF NOT EXISTS idx_pr_promotion_id
    ON promo_redemptions(promotion_id);

CREATE INDEX IF NOT EXISTS idx_pr_campaign_id
    ON promo_redemptions(campaign_id)
    WHERE campaign_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pr_customer_id
    ON promo_redemptions(customer_id)
    WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pr_promo_code
    ON promo_redemptions(promo_code);

CREATE INDEX IF NOT EXISTS idx_pr_redeemed_at
    ON promo_redemptions(redeemed_at DESC);

-- Индекс для контроля одноразовых промокодов (один промокод — один телефон)
CREATE UNIQUE INDEX IF NOT EXISTS idx_pr_phone_promo_unique
    ON promo_redemptions(customer_phone, promo_code)
    WHERE status = 'applied';

-- ---------------------------------------------------------------------------
-- 4. ALTER photo_print_orders — добавить привязку к кампании
-- ---------------------------------------------------------------------------
ALTER TABLE photo_print_orders
    ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES marketing_campaigns(id);

CREATE INDEX IF NOT EXISTS idx_ppo_campaign_id
    ON photo_print_orders(campaign_id)
    WHERE campaign_id IS NOT NULL;

COMMENT ON COLUMN photo_print_orders.campaign_id IS 'Маркетинговая кампания, привлёкшая этот заказ';

-- ---------------------------------------------------------------------------
-- 5. Триггер updated_at для marketing_campaigns
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_marketing_campaigns_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS marketing_campaigns_updated_at ON marketing_campaigns;
CREATE TRIGGER marketing_campaigns_updated_at
    BEFORE UPDATE ON marketing_campaigns
    FOR EACH ROW
    EXECUTE FUNCTION trg_marketing_campaigns_updated_at();

COMMIT;
