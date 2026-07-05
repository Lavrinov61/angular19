-- Portrait as a standalone CRM-orderable category
-- Replaces portrait-bundle addon in photo-docs extras
-- and portrait-photo in studio-special

BEGIN;

-- 1. Create portrait category (after photo-docs, sort_order=2)
INSERT INTO service_categories (slug, name, description, icon, is_active, crm_orderable, sort_order, valid_delivery_methods, display_channels)
VALUES (
  'portrait',
  'Портретная съёмка',
  'Портретная фотосъёмка в студии с профессиональной обработкой',
  'portrait',
  true,
  true,
  2, -- after photo-docs (1)
  ARRAY['pickup']::text[],
  ARRAY['crm', 'pos']::text[]
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  is_active = true,
  crm_orderable = true,
  sort_order = EXCLUDED.sort_order,
  valid_delivery_methods = EXCLUDED.valid_delivery_methods,
  display_channels = EXCLUDED.display_channels;

-- 2. Create option groups

-- 2a. Processing level (single select, required)
INSERT INTO option_groups (service_category_id, slug, name, description, selection_type, is_required, min_selections, max_selections, sort_order)
SELECT sc.id, 'portrait-processing', 'Уровень обработки', 'Выберите уровень ретуши для портрета', 'single', true, 1, 1, 1
FROM service_categories sc WHERE sc.slug = 'portrait'
ON CONFLICT DO NOTHING;

-- 2b. Format / print size (single select, optional)
INSERT INTO option_groups (service_category_id, slug, name, description, selection_type, is_required, min_selections, max_selections, sort_order)
SELECT sc.id, 'portrait-format', 'Формат печати', 'Размер печати портрета', 'single', false, 0, 1, 2
FROM service_categories sc WHERE sc.slug = 'portrait'
ON CONFLICT DO NOTHING;

-- 3. Create options for portrait-processing
-- (prices match document photo processing levels for consistency)

INSERT INTO service_options (option_group_id, slug, name, description, base_price, price_studio, price_online, icon, is_active, sort_order, popular)
SELECT og.id, 'portrait-basic', 'Базовая', 'Замена фона, коррекция света и цвета', 900.00, 600.00, 900.00, 'photo_camera', true, 1, false
FROM option_groups og
JOIN service_categories sc ON og.service_category_id = sc.id
WHERE sc.slug = 'portrait' AND og.slug = 'portrait-processing'
  AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.option_group_id = og.id AND so.slug = 'portrait-basic')
UNION ALL
SELECT og.id, 'portrait-pro', 'Профессиональная', 'Ручная ретушь кожи, причёски, деталей одежды', 1490.00, 900.00, 1490.00, 'auto_fix_high', true, 2, true
FROM option_groups og
JOIN service_categories sc ON og.service_category_id = sc.id
WHERE sc.slug = 'portrait' AND og.slug = 'portrait-processing'
  AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.option_group_id = og.id AND so.slug = 'portrait-pro')
UNION ALL
SELECT og.id, 'portrait-premium', 'Премиальная', 'Полная художественная обработка, цветокоррекция, стилизация', 2490.00, 1400.00, 2490.00, 'diamond', true, 3, false
FROM option_groups og
JOIN service_categories sc ON og.service_category_id = sc.id
WHERE sc.slug = 'portrait' AND og.slug = 'portrait-processing'
  AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.option_group_id = og.id AND so.slug = 'portrait-premium');

-- 4. Create options for portrait-format (real photo-print prices: premium/super)

INSERT INTO service_options (option_group_id, slug, name, description, base_price, price_studio, price_online, icon, is_active, sort_order)
SELECT og.id, 'portrait-digital', 'Цифровой файл', 'Файл в высоком разрешении (включено)', 0.00, 0.00, 0.00, 'image', true, 1
FROM option_groups og
JOIN service_categories sc ON og.service_category_id = sc.id
WHERE sc.slug = 'portrait' AND og.slug = 'portrait-format'
  AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.option_group_id = og.id AND so.slug = 'portrait-digital')
UNION ALL
SELECT og.id, 'portrait-10x15-premium', 'Печать 10×15 премиум (матт)', 'Печать портрета 10×15 см, матовая бумага', 19.50, 19.50, 19.50, 'photo_size_select_large', true, 2
FROM option_groups og
JOIN service_categories sc ON og.service_category_id = sc.id
WHERE sc.slug = 'portrait' AND og.slug = 'portrait-format'
  AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.option_group_id = og.id AND so.slug = 'portrait-10x15-premium')
UNION ALL
SELECT og.id, 'portrait-10x15-super', 'Печать 10×15 супер (глянец)', 'Печать портрета 10×15 см, глянцевая бумага', 36.00, 36.00, 36.00, 'photo_size_select_large', true, 3
FROM option_groups og
JOIN service_categories sc ON og.service_category_id = sc.id
WHERE sc.slug = 'portrait' AND og.slug = 'portrait-format'
  AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.option_group_id = og.id AND so.slug = 'portrait-10x15-super')
UNION ALL
SELECT og.id, 'portrait-15x20-premium', 'Печать 15×20 премиум (матт)', 'Печать портрета 15×20 см, матовая бумага', 49.00, 49.00, 49.00, 'photo_size_select_large', true, 4
FROM option_groups og
JOIN service_categories sc ON og.service_category_id = sc.id
WHERE sc.slug = 'portrait' AND og.slug = 'portrait-format'
  AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.option_group_id = og.id AND so.slug = 'portrait-15x20-premium')
UNION ALL
SELECT og.id, 'portrait-15x20-super', 'Печать 15×20 супер (глянец)', 'Печать портрета 15×20 см, глянцевая бумага', 70.00, 70.00, 70.00, 'photo_size_select_large', true, 5
FROM option_groups og
JOIN service_categories sc ON og.service_category_id = sc.id
WHERE sc.slug = 'portrait' AND og.slug = 'portrait-format'
  AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.option_group_id = og.id AND so.slug = 'portrait-15x20-super')
UNION ALL
SELECT og.id, 'portrait-20x30-premium', 'Печать 20×30 премиум (матт)', 'Печать портрета 20×30 см, матовая бумага', 117.00, 117.00, 117.00, 'photo_size_select_large', true, 6
FROM option_groups og
JOIN service_categories sc ON og.service_category_id = sc.id
WHERE sc.slug = 'portrait' AND og.slug = 'portrait-format'
  AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.option_group_id = og.id AND so.slug = 'portrait-20x30-premium')
UNION ALL
SELECT og.id, 'portrait-20x30-super', 'Печать 20×30 супер (глянец)', 'Печать портрета 20×30 см, глянцевая бумага', 140.00, 140.00, 140.00, 'photo_size_select_large', true, 7
FROM option_groups og
JOIN service_categories sc ON og.service_category_id = sc.id
WHERE sc.slug = 'portrait' AND og.slug = 'portrait-format'
  AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.option_group_id = og.id AND so.slug = 'portrait-20x30-super');

-- 5. Deactivate portrait-bundle from photo-docs extras (no longer an addon)
UPDATE service_options SET is_active = false
WHERE slug = 'portrait-bundle'
  AND option_group_id IN (
    SELECT og.id FROM option_groups og
    JOIN service_categories sc ON og.service_category_id = sc.id
    WHERE sc.slug = 'photo-docs' AND og.slug = 'extras'
  );

-- 6. Deactivate portrait-photo from studio-special (duplicate, now in portrait category)
UPDATE service_options SET is_active = false
WHERE slug = 'portrait-photo'
  AND option_group_id IN (
    SELECT og.id FROM option_groups og
    JOIN service_categories sc ON og.service_category_id = sc.id
    WHERE sc.slug = 'studio-special'
  );

-- 7. Invalidate Redis pricing cache (handled by app on next request)

COMMIT;
