-- Expand partner types: promoter, agent, online (from promo-job)
-- Add hourly_rate for promoter shifts

-- hourly_rate for promoter type (150 rub/hour default)
ALTER TABLE partners ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(8,2) DEFAULT NULL;

-- No CHECK constraint on type column — validation is app-level only
-- New valid types: promoter, agent, online (+ existing referral, business, affiliate)
