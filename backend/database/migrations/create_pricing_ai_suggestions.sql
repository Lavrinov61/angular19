-- Migration: create pricing_ai_suggestions table
-- Хранит предложения ИИ по изменению цен с workflow approve/reject

CREATE TABLE IF NOT EXISTS pricing_ai_suggestions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    option_slug      VARCHAR(100) NOT NULL,
    option_name      VARCHAR(200) NOT NULL,
    current_price    NUMERIC(10, 2) NOT NULL,
    suggested_price  NUMERIC(10, 2) NOT NULL,
    discount_percent INTEGER NOT NULL CHECK (discount_percent >= 0 AND discount_percent <= 30),
    reason           TEXT,
    valid_from       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    valid_until      TIMESTAMPTZ NOT NULL,
    status           VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    requested_by     VARCHAR(100),
    reviewed_by      VARCHAR(100),
    reviewed_at      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pricing_ai_suggestions_status ON pricing_ai_suggestions(status);
CREATE INDEX IF NOT EXISTS idx_pricing_ai_suggestions_option ON pricing_ai_suggestions(option_slug);
CREATE INDEX IF NOT EXISTS idx_pricing_ai_suggestions_created ON pricing_ai_suggestions(created_at DESC);

COMMENT ON TABLE pricing_ai_suggestions IS
    'Предложения ИИ по изменению цен. Применяются только после approve администратора.';
