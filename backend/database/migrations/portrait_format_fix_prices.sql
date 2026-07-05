-- Fix portrait print format prices: use real photo-print prices (premium/super)
-- instead of made-up 200/400/700 values

BEGIN;

-- 1. Delete old incorrect options
DELETE FROM service_options
WHERE slug IN ('portrait-10x15', 'portrait-15x20', 'portrait-20x30')
  AND option_group_id IN (
    SELECT og.id FROM option_groups og
    JOIN service_categories sc ON og.service_category_id = sc.id
    WHERE sc.slug = 'portrait' AND og.slug = 'portrait-format'
  );

-- 2. Insert real print options (premium + super, matching photo-print prices)
INSERT INTO service_options (option_group_id, slug, name, description, base_price, price_studio, price_online, icon, is_active, sort_order)

-- 10x15 premium
SELECT og.id, 'portrait-10x15-premium', 'Печать 10×15 премиум (матт)', 'Печать портрета 10×15 см, матовая бумага', 19.50, 19.50, 19.50, 'photo_size_select_large', true, 2
FROM option_groups og
JOIN service_categories sc ON og.service_category_id = sc.id
WHERE sc.slug = 'portrait' AND og.slug = 'portrait-format'
  AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.option_group_id = og.id AND so.slug = 'portrait-10x15-premium')

UNION ALL

-- 10x15 super
SELECT og.id, 'portrait-10x15-super', 'Печать 10×15 супер (глянец)', 'Печать портрета 10×15 см, глянцевая бумага', 36.00, 36.00, 36.00, 'photo_size_select_large', true, 3
FROM option_groups og
JOIN service_categories sc ON og.service_category_id = sc.id
WHERE sc.slug = 'portrait' AND og.slug = 'portrait-format'
  AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.option_group_id = og.id AND so.slug = 'portrait-10x15-super')

UNION ALL

-- 15x20 premium
SELECT og.id, 'portrait-15x20-premium', 'Печать 15×20 премиум (матт)', 'Печать портрета 15×20 см, матовая бумага', 49.00, 49.00, 49.00, 'photo_size_select_large', true, 4
FROM option_groups og
JOIN service_categories sc ON og.service_category_id = sc.id
WHERE sc.slug = 'portrait' AND og.slug = 'portrait-format'
  AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.option_group_id = og.id AND so.slug = 'portrait-15x20-premium')

UNION ALL

-- 15x20 super
SELECT og.id, 'portrait-15x20-super', 'Печать 15×20 супер (глянец)', 'Печать портрета 15×20 см, глянцевая бумага', 70.00, 70.00, 70.00, 'photo_size_select_large', true, 5
FROM option_groups og
JOIN service_categories sc ON og.service_category_id = sc.id
WHERE sc.slug = 'portrait' AND og.slug = 'portrait-format'
  AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.option_group_id = og.id AND so.slug = 'portrait-15x20-super')

UNION ALL

-- 20x30 premium
SELECT og.id, 'portrait-20x30-premium', 'Печать 20×30 премиум (матт)', 'Печать портрета 20×30 см, матовая бумага', 117.00, 117.00, 117.00, 'photo_size_select_large', true, 6
FROM option_groups og
JOIN service_categories sc ON og.service_category_id = sc.id
WHERE sc.slug = 'portrait' AND og.slug = 'portrait-format'
  AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.option_group_id = og.id AND so.slug = 'portrait-20x30-premium')

UNION ALL

-- 20x30 super
SELECT og.id, 'portrait-20x30-super', 'Печать 20×30 супер (глянец)', 'Печать портрета 20×30 см, глянцевая бумага', 140.00, 140.00, 140.00, 'photo_size_select_large', true, 7
FROM option_groups og
JOIN service_categories sc ON og.service_category_id = sc.id
WHERE sc.slug = 'portrait' AND og.slug = 'portrait-format'
  AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.option_group_id = og.id AND so.slug = 'portrait-20x30-super');

COMMIT;
