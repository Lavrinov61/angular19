-- Print Public API — volume discounts + paper type support
-- Idempotent: safe to run multiple times

BEGIN;

-- Add paper_type column to service_catalog for photo print variants
ALTER TABLE service_catalog ADD COLUMN IF NOT EXISTS paper_type VARCHAR(20);

-- Update existing photo_print rows with volume discounts and paper type info
-- price_rules stores volume thresholds: [{min_qty, price_per_unit}]
-- paper_type NULL means "applies to all paper types" (default glossy pricing)

UPDATE service_catalog
SET price_rules = jsonb_build_object(
  'volume_discounts', jsonb_build_array(
    jsonb_build_object('min_qty', 1,   'price_per_unit', 15),
    jsonb_build_object('min_qty', 10,  'price_per_unit', 13),
    jsonb_build_object('min_qty', 50,  'price_per_unit', 11),
    jsonb_build_object('min_qty', 100, 'price_per_unit', 9)
  ),
  'paper_types', jsonb_build_array('glossy', 'matte'),
  'matte_surcharge', 0
)
WHERE slug = 'photo-10x15' AND (price_rules IS NULL OR price_rules = '{}'::jsonb);

UPDATE service_catalog
SET price_rules = jsonb_build_object(
  'volume_discounts', jsonb_build_array(
    jsonb_build_object('min_qty', 1,   'price_per_unit', 40),
    jsonb_build_object('min_qty', 10,  'price_per_unit', 35),
    jsonb_build_object('min_qty', 50,  'price_per_unit', 30)
  ),
  'paper_types', jsonb_build_array('glossy', 'matte'),
  'matte_surcharge', 0
)
WHERE slug = 'photo-15x20' AND (price_rules IS NULL OR price_rules = '{}'::jsonb);

UPDATE service_catalog
SET price_rules = jsonb_build_object(
  'volume_discounts', jsonb_build_array(
    jsonb_build_object('min_qty', 1,  'price_per_unit', 80),
    jsonb_build_object('min_qty', 10, 'price_per_unit', 70),
    jsonb_build_object('min_qty', 50, 'price_per_unit', 60)
  ),
  'paper_types', jsonb_build_array('glossy', 'matte'),
  'matte_surcharge', 5
)
WHERE slug = 'photo-20x30' AND (price_rules IS NULL OR price_rules = '{}'::jsonb);

UPDATE service_catalog
SET price_rules = jsonb_build_object(
  'volume_discounts', jsonb_build_array(
    jsonb_build_object('min_qty', 1,  'price_per_unit', 120),
    jsonb_build_object('min_qty', 10, 'price_per_unit', 100)
  ),
  'paper_types', jsonb_build_array('glossy', 'matte'),
  'matte_surcharge', 10
)
WHERE slug = 'photo-a4' AND (price_rules IS NULL OR price_rules = '{}'::jsonb);

-- Insert 30x45 format if not exists
INSERT INTO service_catalog (slug, name, category, required_device_type, base_price, price_per_unit, price_rules, sort_order)
VALUES (
  'photo-30x45', 'Фотопечать 30×45', 'photo_print', 'photo', 0, 200,
  jsonb_build_object(
    'volume_discounts', jsonb_build_array(
      jsonb_build_object('min_qty', 1,  'price_per_unit', 200),
      jsonb_build_object('min_qty', 10, 'price_per_unit', 170)
    ),
    'paper_types', jsonb_build_array('glossy', 'matte'),
    'matte_surcharge', 10
  ),
  5
)
ON CONFLICT (slug) DO NOTHING;

COMMIT;
