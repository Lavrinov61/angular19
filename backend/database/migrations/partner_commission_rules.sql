-- Partner Commission Rules: per-service/per-category commission rates
-- Applied: 2026-03-26

-- Main rules table
CREATE TABLE IF NOT EXISTS partner_commission_rules (
  id SERIAL PRIMARY KEY,
  partner_id INTEGER NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  service_category_slug VARCHAR(100),          -- NULL = default for all categories
  order_type VARCHAR(20),                       -- 'pos', 'print', 'booking', NULL = all types
  commission_percent NUMERIC(5,2),              -- percentage (e.g. 15.00 = 15%)
  commission_fixed NUMERIC(10,2),               -- alternative: fixed amount in RUB
  min_order_amount NUMERIC(10,2) DEFAULT 0,     -- minimum order to apply commission
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  priority INTEGER NOT NULL DEFAULT 0,          -- higher = checked first
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_commission_value CHECK (
    commission_percent IS NOT NULL OR commission_fixed IS NOT NULL
  ),
  CONSTRAINT uq_partner_rule UNIQUE (partner_id, service_category_slug, order_type)
);

-- Indexes for specificity-first lookup
CREATE INDEX IF NOT EXISTS idx_pcr_partner_id ON partner_commission_rules(partner_id);
CREATE INDEX IF NOT EXISTS idx_pcr_partner_category ON partner_commission_rules(partner_id, service_category_slug);
CREATE INDEX IF NOT EXISTS idx_pcr_active ON partner_commission_rules(partner_id, is_active) WHERE is_active = TRUE;

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_partner_commission_rules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_partner_commission_rules_updated ON partner_commission_rules;
CREATE TRIGGER trg_partner_commission_rules_updated
  BEFORE UPDATE ON partner_commission_rules
  FOR EACH ROW EXECUTE FUNCTION update_partner_commission_rules_updated_at();

-- Seed default rules for existing partners (fallback: use their current commission_rate)
INSERT INTO partner_commission_rules (partner_id, service_category_slug, order_type, commission_percent, priority)
SELECT id, NULL, NULL, commission_rate, 0
FROM partners
WHERE commission_rate IS NOT NULL AND commission_rate > 0
ON CONFLICT (partner_id, service_category_slug, order_type) DO NOTHING;
