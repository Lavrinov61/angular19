-- Cross-category price_override rules support
-- service_category_id = NULL means rule applies across categories in waterfall

BEGIN;

-- 1. Allow NULL service_category_id for cross-category rules
ALTER TABLE option_rules ALTER COLUMN service_category_id DROP NOT NULL;

-- 2. Rule: when any photo-docs document-type option is present,
--    portrait-photo price overrides to 600₽ (combo discount)
--    source = passport-rf (most common doc type, triggers the rule)
--    target = portrait-photo
--
--    We use a special approach: source_option_id = NULL means
--    "any option from source category triggers this rule"
--    But current schema requires source_option_id NOT NULL.
--    Instead: insert one rule per active document-type option.

-- Actually, cleaner: use a single rule with a wildcard source.
-- Add source_category_id to enable "any option from category X" rules.
ALTER TABLE option_rules ADD COLUMN IF NOT EXISTS source_category_id uuid REFERENCES service_categories(id) ON DELETE CASCADE;

-- Insert: any photo-docs item → portrait-photo at 600₽
INSERT INTO option_rules (service_category_id, rule_type, source_option_id, target_option_id, override_price, description, source_category_id)
SELECT
  NULL,                           -- cross-category (no single category scope)
  'price_override',
  (SELECT id FROM service_options WHERE slug = 'passport-rf' LIMIT 1),  -- placeholder source
  (SELECT id FROM service_options WHERE slug = 'portrait-photo' LIMIT 1),
  600.00,
  'Фото на документы + портрет = портрет со скидкой 900→600₽',
  (SELECT id FROM service_categories WHERE slug = 'photo-docs')  -- source category
WHERE NOT EXISTS (
  SELECT 1 FROM option_rules
  WHERE target_option_id = (SELECT id FROM service_options WHERE slug = 'portrait-photo' LIMIT 1)
    AND rule_type = 'price_override'
    AND source_category_id IS NOT NULL
);

COMMIT;
