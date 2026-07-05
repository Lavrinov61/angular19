-- Fix: degressive pricing applied to ALL options in category (including addons)
-- Root cause: categoryTotalQty counted processing-level/extras/speed options
-- toward degressive ranking, causing them to get reduced prices.
-- Solution: explicit degressive_groups field limits degressive to document-type only.
--
-- Already applied: 2026-03-23

UPDATE service_categories
SET metadata = jsonb_set(
  COALESCE(metadata, '{}'::jsonb),
  '{degressive,degressive_groups}',
  '["document-type"]'::jsonb
)
WHERE slug = 'photo-docs'
  AND metadata ? 'degressive'
  AND NOT (metadata->'degressive' ? 'degressive_groups');
