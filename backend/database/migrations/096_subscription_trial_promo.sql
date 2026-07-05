-- Migration 096: Trial subscriptions + Studvesna 2026 promo codes
-- Idempotent: safe to run multiple times

BEGIN;

-- 1. Add trial fields to user_subscriptions
ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS trial_period_days INTEGER DEFAULT 0;
ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS trial_end TIMESTAMPTZ;
ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS promo_code_used VARCHAR(50);

-- 2. Add trial_days to promotions
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS trial_days INTEGER DEFAULT 0;

-- 3. Generate 100 unique SVV-XXXXX promo codes for Studvesna 2026
INSERT INTO promotions (slug, title, description, promo_code, discount_percent, discount_amount, trial_days, usage_limit, usage_count, is_active, starts_at, ends_at, service_slug)
SELECT
  'studvesna-2026-' || LPAD(n::text, 3, '0'),
  'Студвесна 2026',
  'Приз Студвесна 2026 — бесплатная подписка на 3 месяца',
  'SVV-' || substr(md5(random()::text || n::text || clock_timestamp()::text), 1, 5),
  NULL,
  NULL,
  90,
  1,
  0,
  true,
  '2026-04-15'::timestamptz,
  '2026-06-15'::timestamptz,
  NULL
FROM generate_series(1, 100) AS n
ON CONFLICT (slug) DO NOTHING;

-- Fix codes: ensure uppercase alphanumeric (A-Z, 0-9) format
-- md5 produces hex (0-9, a-f), replace letters and uppercase
UPDATE promotions
SET promo_code = 'SVV-' || upper(
  translate(
    substr(md5(slug || random()::text || clock_timestamp()::text), 1, 5),
    'abcdef',
    'KLMNPQ'
  )
)
WHERE slug LIKE 'studvesna-2026-%'
  AND promo_code LIKE 'SVV-%'
  AND length(promo_code) = 9;

-- 4. Update existing STUDVESNA26 promo
UPDATE promotions SET
  usage_limit = 500,
  starts_at = '2026-04-15'::timestamptz,
  ends_at = '2026-04-17'::timestamptz,
  trial_days = 30
WHERE promo_code = 'STUDVESNA26';

COMMIT;
