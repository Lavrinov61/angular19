-- Flyer pricing: per-unit, min 20 pcs
BEGIN;

-- Update flyer A5: 50₽/шт, от 20 шт
UPDATE service_catalog
SET base_price = 0,
    price_per_unit = 50,
    price_rules = '{"min_qty": 20}'::jsonb,
    name = 'Флаер A5',
    updated_at = now()
WHERE slug = 'flyer-a5';

-- Add flyer A6: 25₽/шт, от 20 шт
INSERT INTO service_catalog (slug, name, category, base_price, price_per_unit, price_rules, is_active, sort_order)
VALUES ('flyer-a6', 'Флаер A6', 'polygraphy', 0, 25, '{"min_qty": 20}'::jsonb, true, 2)
ON CONFLICT (slug) DO UPDATE SET
    price_per_unit = 25,
    price_rules = '{"min_qty": 20}'::jsonb,
    updated_at = now();

COMMIT;
