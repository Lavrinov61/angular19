BEGIN;

ALTER TABLE service_categories
  ADD COLUMN IF NOT EXISTS processing_time VARCHAR(100);

ALTER TABLE service_options
  ADD COLUMN IF NOT EXISTS processing_time VARCHAR(100);

-- Category-level defaults
UPDATE service_categories
SET processing_time = '2-3 часа'
WHERE slug = 'photo-docs';

UPDATE service_categories
SET processing_time = '1-2 дня'
WHERE slug = 'voennaya-retush';

-- Speed options for photo-docs
UPDATE service_options so
SET processing_time = '2-3 часа'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE so.option_group_id = og.id
  AND sc.slug = 'photo-docs'
  AND og.slug = 'speed'
  AND so.slug = 'normal';

UPDATE service_options so
SET processing_time = '1 час'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE so.option_group_id = og.id
  AND sc.slug = 'photo-docs'
  AND og.slug = 'speed'
  AND so.slug = 'urgent';

-- Speed options for voennaya-retush
UPDATE service_options so
SET processing_time = '1-2 дня'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE so.option_group_id = og.id
  AND sc.slug = 'voennaya-retush'
  AND og.slug = 'speed'
  AND so.slug = 'normal';

UPDATE service_options so
SET processing_time = 'до 12 часов'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE so.option_group_id = og.id
  AND sc.slug = 'voennaya-retush'
  AND og.slug = 'speed'
  AND so.slug = 'urgent';

COMMIT;
