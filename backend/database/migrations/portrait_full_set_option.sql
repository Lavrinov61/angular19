-- Add "full raw set" option to portrait format group
-- Customer can buy all original photos from the session for 4500₽

BEGIN;

INSERT INTO service_options (option_group_id, slug, name, description, base_price, price_studio, price_online, icon, is_active, sort_order)
SELECT og.id, 'portrait-full-set', 'Весь сет исходников', 'Все оригиналы фотосъёмки без обработки', 4500.00, 4500.00, 4500.00, 'photo_library', true, 0
FROM option_groups og
JOIN service_categories sc ON og.service_category_id = sc.id
WHERE sc.slug = 'portrait' AND og.slug = 'portrait-format'
  AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.option_group_id = og.id AND so.slug = 'portrait-full-set');

COMMIT;
