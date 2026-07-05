-- Remove the misleading "Без обработки +0" processing tier from active catalogs.
-- Keep the rows for historical order references; active pricing/catalog queries
-- must no longer expose processing-none for photo documents or portraits.

BEGIN;

UPDATE service_options so
SET is_active = false,
    updated_at = now()
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE so.option_group_id = og.id
  AND og.slug = 'processing-level'
  AND sc.slug IN ('photo-docs', 'portrait')
  AND so.slug = 'processing-none'
  AND so.is_active = true;

COMMIT;
