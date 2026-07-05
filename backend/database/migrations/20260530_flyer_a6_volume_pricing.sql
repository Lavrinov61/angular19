-- Флайеры A6 — тиражные (оптовые) цены:
--   500 шт  = 3125 ₽  → 6.25 ₽/шт
--   1000 шт = 6250 ₽  → 6.25 ₽/шт
-- База 25 ₽/шт для мелких партий (от 20 шт) сохраняется; опт — через price_rules.volume_discounts.
-- Идемпотентно: INSERT ... ON CONFLICT (slug) DO UPDATE.
BEGIN;

INSERT INTO service_catalog (slug, name, category, base_price, price_per_unit, price_rules, is_active, sort_order)
VALUES (
  'flyer-a6', 'Флаер A6', 'polygraphy', 0, 25,
  '{"min_qty": 20, "volume_discounts": [{"min_qty": 500, "price_per_unit": 6.25}, {"min_qty": 1000, "price_per_unit": 6.25}]}'::jsonb,
  true, 2
)
ON CONFLICT (slug) DO UPDATE SET
  price_per_unit = 25,
  price_rules = '{"min_qty": 20, "volume_discounts": [{"min_qty": 500, "price_per_unit": 6.25}, {"min_qty": 1000, "price_per_unit": 6.25}]}'::jsonb,
  updated_at = now();

COMMIT;
