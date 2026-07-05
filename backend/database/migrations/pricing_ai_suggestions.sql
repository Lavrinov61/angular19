-- Таблица предложений ИИ по ценообразованию
-- Используется ai-pricing.service.ts

CREATE TABLE IF NOT EXISTS pricing_ai_suggestions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  option_slug     VARCHAR(255) NOT NULL,
  option_name     VARCHAR(255) NOT NULL,
  current_price   NUMERIC(10,2) NOT NULL,
  suggested_price NUMERIC(10,2) NOT NULL,
  discount_percent INT NOT NULL,
  reason          TEXT NOT NULL,
  valid_from      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until     TIMESTAMPTZ NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pricing_ai_suggestions_status
  ON pricing_ai_suggestions(status);

CREATE INDEX IF NOT EXISTS idx_pricing_ai_suggestions_created_at
  ON pricing_ai_suggestions(created_at DESC);
