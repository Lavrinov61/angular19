-- =============================================================================
-- add_photo_docs_studio_retouch_option.sql
-- =============================================================================
-- Adds a studio-only retouch option for photo-docs category.
-- Business rule: studio package is 700 RUB + optional retouch 600 RUB.
-- =============================================================================

BEGIN;

INSERT INTO service_options (
  option_group_id,
  slug,
  name,
  description,
  icon,
  color,
  base_price,
  price_online,
  price_studio,
  price_next_unit,
  features,
  popular,
  sort_order,
  is_active
)
SELECT
  og.id,
  'studio-retouch',
  'Ретушь (только в студии)',
  'Дополнительная ручная ретушь для студийного комплекта',
  'brush',
  '#4f6f7f',
  0,
  0,
  600,
  600,
  '["Только для студийного заказа", "Ручная ретушь", "Доплата к комплекту 700₽"]'::jsonb,
  false,
  99,
  true
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE sc.slug = 'photo-docs' AND og.slug = 'extras'
ON CONFLICT (option_group_id, slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  color = EXCLUDED.color,
  base_price = EXCLUDED.base_price,
  price_online = EXCLUDED.price_online,
  price_studio = EXCLUDED.price_studio,
  price_next_unit = EXCLUDED.price_next_unit,
  features = EXCLUDED.features,
  is_active = true,
  updated_at = NOW();

COMMIT;
