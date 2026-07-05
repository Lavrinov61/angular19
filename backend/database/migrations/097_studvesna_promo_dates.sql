-- Migration 097: Update Studvesna promo code dates
-- Общий код STUDVESNA26: 2 дня (15-16 апреля)
UPDATE promotions SET
  starts_at = '2026-04-15 00:00:00+03',
  ends_at = '2026-04-17 00:00:00+03'
WHERE promo_code = 'STUDVESNA26';

-- Персональные коды SVV-*: 1 месяц (15 апреля - 15 мая)
UPDATE promotions SET
  starts_at = '2026-04-15 00:00:00+03',
  ends_at = '2026-05-15 23:59:59+03'
WHERE slug LIKE 'studvesna-2026-%' AND promo_code LIKE 'SVV-%';
