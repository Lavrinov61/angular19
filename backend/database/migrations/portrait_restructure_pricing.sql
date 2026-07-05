-- Restructure portrait pricing:
-- OLD: 3 fake "processing levels" (Базовая 600, Про 900, Премиальная 1400)
-- NEW: Portrait photo 900₽ (base product) + Retouch 600₽ (optional addon)

BEGIN;

-- 1. Delete fake processing level options
DELETE FROM service_options
WHERE slug IN ('portrait-basic', 'portrait-pro', 'portrait-premium')
  AND option_group_id IN (
    SELECT og.id FROM option_groups og
    JOIN service_categories sc ON og.service_category_id = sc.id
    WHERE sc.slug = 'portrait' AND og.slug = 'portrait-processing'
  );

-- 2. Rename group to "Портретное фото" — single required option
UPDATE option_groups
SET name = 'Портретное фото', description = 'Студийное портретное фото'
WHERE slug = 'portrait-processing'
  AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'portrait');

-- 3. Insert the base portrait product (900₽)
INSERT INTO service_options (option_group_id, slug, name, description, base_price, price_studio, price_online, icon, is_active, sort_order)
SELECT og.id, 'portrait-photo', 'Портретное фото', 'Студийная портретная фотосъёмка', 900.00, 900.00, 900.00, 'portrait', true, 1
FROM option_groups og
JOIN service_categories sc ON og.service_category_id = sc.id
WHERE sc.slug = 'portrait' AND og.slug = 'portrait-processing'
  AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.option_group_id = og.id AND so.slug = 'portrait-photo');

-- 4. Create optional retouch group (same as photo-docs retouch at 600₽)
INSERT INTO option_groups (service_category_id, slug, name, description, selection_type, is_required, min_selections, max_selections, sort_order)
SELECT sc.id, 'portrait-retouch', 'Дополнительно', 'Дополнительные услуги к портрету', 'multi', false, 0, 10, 1
FROM service_categories sc WHERE sc.slug = 'portrait'
ON CONFLICT (service_category_id, slug) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description,
  selection_type = EXCLUDED.selection_type, is_required = EXCLUDED.is_required;

-- 5. Insert retouch option (600₽)
INSERT INTO service_options (option_group_id, slug, name, description, base_price, price_studio, price_online, icon, is_active, sort_order)
SELECT og.id, 'portrait-retouch-option', 'Ретушь', 'Профессиональная ретушь портрета', 600.00, 600.00, 600.00, 'auto_fix_high', true, 1
FROM option_groups og
JOIN service_categories sc ON og.service_category_id = sc.id
WHERE sc.slug = 'portrait' AND og.slug = 'portrait-retouch'
  AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.option_group_id = og.id AND so.slug = 'portrait-retouch-option');

-- 6. Reorder groups: base product (0) → retouch (1) → print format (2)
UPDATE option_groups SET sort_order = 0
WHERE slug = 'portrait-processing'
  AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'portrait');

UPDATE option_groups SET sort_order = 1
WHERE slug = 'portrait-retouch'
  AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'portrait');

UPDATE option_groups SET sort_order = 2
WHERE slug = 'portrait-format'
  AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'portrait');

COMMIT;
