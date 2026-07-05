-- Portrait category cleanup:
-- 1. Deactivate useless "digital file" option (always sent anyway)
-- 2. Fix retouch group: max 1 selection, not 10
-- 3. Print format → multi-select (can pick print AND full set)

BEGIN;

-- Deactivate digital file option
UPDATE service_options SET is_active = false
WHERE slug = 'portrait-digital';

-- Fix retouch group: max 1 retouch per portrait
UPDATE option_groups SET max_selections = 1
WHERE slug = 'portrait-retouch'
  AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'portrait');

-- Print format → multi-select so customer can order prints AND full set
UPDATE option_groups SET selection_type = 'multi', max_selections = 10
WHERE slug = 'portrait-format'
  AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'portrait');

COMMIT;
