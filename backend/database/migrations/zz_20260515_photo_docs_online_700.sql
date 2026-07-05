-- Align photo-docs online pricing with the current 700 ruble base tariff.
-- Document type options identify the required document only; processing level carries the price.

BEGIN;

UPDATE service_options so
SET price_online = 0,
    price_next_unit = NULL,
    updated_at = now()
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE so.option_group_id = og.id
  AND sc.slug = 'photo-docs'
  AND og.slug = 'document-type'
  AND (so.price_online IS DISTINCT FROM 0 OR so.price_next_unit IS NOT NULL);

UPDATE service_options so
SET is_active = true,
    base_price = 700,
    price_online = 700,
    price_studio = 700,
    price_next_unit = 700,
    updated_at = now()
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE so.option_group_id = og.id
  AND sc.slug = 'photo-docs'
  AND og.slug = 'processing-level'
  AND so.slug = 'processing-basic'
  AND (
    so.is_active IS DISTINCT FROM true
    OR so.base_price IS DISTINCT FROM 700
    OR so.price_online IS DISTINCT FROM 700
    OR so.price_studio IS DISTINCT FROM 700
    OR so.price_next_unit IS DISTINCT FROM 700
  );

UPDATE service_options so
SET is_active = true,
    base_price = 950,
    price_online = 950,
    price_studio = 950,
    updated_at = now()
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE so.option_group_id = og.id
  AND sc.slug = 'photo-docs'
  AND og.slug = 'processing-level'
  AND so.slug = 'processing-extended'
  AND (
    so.is_active IS DISTINCT FROM true
    OR so.base_price IS DISTINCT FROM 950
    OR so.price_online IS DISTINCT FROM 950
    OR so.price_studio IS DISTINCT FROM 950
  );

UPDATE service_categories
SET price_range = 'от 700₽',
    updated_at = now()
WHERE slug = 'photo-docs'
  AND price_range IS DISTINCT FROM 'от 700₽';

COMMIT;
