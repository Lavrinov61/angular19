-- Treat retouch/processing tiers as add-ons, not mandatory replacements for
-- the base document/portrait service. The active processing-* options stay in
-- the catalog; customers can add them on top of the base price.

BEGIN;

UPDATE option_groups og
SET is_required = false,
    min_selections = 0,
    updated_at = now()
FROM service_categories sc
WHERE og.service_category_id = sc.id
  AND sc.slug IN ('photo-docs', 'portrait')
  AND og.slug = 'processing-level'
  AND (
    og.is_required IS DISTINCT FROM false
    OR og.min_selections IS DISTINCT FROM 0
  );

COMMIT;
