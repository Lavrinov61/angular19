-- Structured competitor prices extracted from websites
-- Idempotent: IF NOT EXISTS

CREATE TABLE IF NOT EXISTS kb_competitor_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id UUID NOT NULL REFERENCES kb_entities(id) ON DELETE CASCADE,
  service_name TEXT NOT NULL,
  service_category TEXT NOT NULL DEFAULT 'other',
  price_min INT,
  price_max INT,
  price_text TEXT NOT NULL,
  unit TEXT DEFAULT 'шт',
  notes TEXT,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (competitor_id, service_name)
);

CREATE INDEX IF NOT EXISTS idx_competitor_prices_competitor ON kb_competitor_prices(competitor_id);
CREATE INDEX IF NOT EXISTS idx_competitor_prices_category ON kb_competitor_prices(service_category);
