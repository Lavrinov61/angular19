BEGIN;

WITH target_group AS (
  SELECT og.id
  FROM option_groups og
  JOIN service_categories sc ON sc.id = og.service_category_id
  WHERE sc.slug = 'photo-print-format'
    AND og.slug = 'photo-formats'
  LIMIT 1
)
INSERT INTO service_options (
  option_group_id,
  slug,
  name,
  description,
  icon,
  base_price,
  price_studio,
  price_online,
  popular,
  features,
  sort_order,
  is_active
)
SELECT
  target_group.id,
  'km-в-стиле-полароид',
  'В стиле Полароид',
  'Печать фото 10x15 с рамкой в стиле Polaroid',
  'sell',
  36.00,
  36.00,
  NULL,
  false,
  '["10x15", "Polaroid-рамка"]'::jsonb,
  3,
  true
FROM target_group
ON CONFLICT (option_group_id, slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  base_price = EXCLUDED.base_price,
  price_studio = EXCLUDED.price_studio,
  price_online = EXCLUDED.price_online,
  popular = EXCLUDED.popular,
  features = EXCLUDED.features,
  sort_order = EXCLUDED.sort_order,
  is_active = true,
  updated_at = now();

UPDATE service_options so
SET sort_order = CASE so.slug
  WHEN 'km-фото-10x15-премиум' THEN 1
  WHEN 'km-фото-10x15-супер' THEN 2
  WHEN 'km-в-стиле-полароид' THEN 3
  WHEN 'km-фото-15x20-премиум' THEN 4
  WHEN 'km-фото-15x20-супер' THEN 5
  WHEN 'km-фото-20x30-премиум' THEN 6
  WHEN 'km-фото-20x30-супер' THEN 7
  WHEN 'km-30x40-печать-фото' THEN 8
  WHEN 'km-40x50-печать-фото' THEN 9
  WHEN 'km-а2-42-x-60-печать-фото' THEN 10
  ELSE so.sort_order
END,
updated_at = now()
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE so.option_group_id = og.id
  AND sc.slug = 'photo-print-format'
  AND og.slug = 'photo-formats'
  AND so.slug IN (
    'km-фото-10x15-премиум',
    'km-фото-10x15-супер',
    'km-в-стиле-полароид',
    'km-фото-15x20-премиум',
    'km-фото-15x20-супер',
    'km-фото-20x30-премиум',
    'km-фото-20x30-супер',
    'km-30x40-печать-фото',
    'km-40x50-печать-фото',
    'km-а2-42-x-60-печать-фото'
  );

COMMIT;
