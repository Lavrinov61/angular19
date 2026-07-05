-- Competitive Intelligence: price history, alerts, scrape logs
-- Idempotent (IF NOT EXISTS / OR REPLACE)

-- 1. Price history — tracks every price change over time
CREATE TABLE IF NOT EXISTS kb_price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id UUID NOT NULL REFERENCES kb_entities(id) ON DELETE CASCADE,
  service_name TEXT NOT NULL,
  service_category TEXT NOT NULL DEFAULT 'other',
  old_price INT,
  new_price INT,
  change_pct NUMERIC(6,2),
  change_type TEXT NOT NULL DEFAULT 'update',  -- initial, update, removed, new_service
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_history_competitor ON kb_price_history(competitor_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_history_category ON kb_price_history(service_category, recorded_at DESC);

-- 2. Price alerts — significant changes and events
CREATE TABLE IF NOT EXISTS kb_price_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id UUID NOT NULL REFERENCES kb_entities(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL,            -- price_increase, price_decrease, new_service, removed_service
  severity TEXT NOT NULL DEFAULT 'info', -- info (>5%), warning (>10%), critical (>20%)
  title TEXT NOT NULL,
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  read_by UUID,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_alerts_unread ON kb_price_alerts(created_at DESC) WHERE NOT is_read;
CREATE INDEX IF NOT EXISTS idx_price_alerts_competitor ON kb_price_alerts(competitor_id);

-- 3. Scrape logs — per-run diagnostics
CREATE TABLE IF NOT EXISTS kb_scrape_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_slug TEXT NOT NULL,
  competitor_slug TEXT,
  status TEXT NOT NULL,               -- success, partial, failed
  pages_discovered INT NOT NULL DEFAULT 0,
  pages_scraped INT NOT NULL DEFAULT 0,
  items_found INT NOT NULL DEFAULT 0,
  prices_extracted INT NOT NULL DEFAULT 0,
  prices_saved INT NOT NULL DEFAULT 0,
  extraction_method TEXT,             -- llm, regex, both, none
  chrome_used BOOLEAN NOT NULL DEFAULT FALSE,
  reqwest_used BOOLEAN NOT NULL DEFAULT FALSE,
  errors JSONB NOT NULL DEFAULT '[]',
  duration_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scrape_logs_source ON kb_scrape_logs(source_slug, created_at DESC);

-- 4. Extend kb_competitor_prices with provenance columns
ALTER TABLE kb_competitor_prices
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS extraction_method TEXT DEFAULT 'scraper';
