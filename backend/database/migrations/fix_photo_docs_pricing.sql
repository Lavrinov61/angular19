-- Fix photo-docs pricing for online orders
-- 1. Activate "basic" (Экспресс) option — needed for quick order form
-- 2. Zero out document type online prices — they're just format selections, not separate services

BEGIN;

-- 1. Activate basic/Express option
UPDATE service_options
SET is_active = true
WHERE slug = 'basic'
  AND option_group_id = (
    SELECT og.id FROM option_groups og
    JOIN service_categories sc ON sc.id = og.service_category_id
    WHERE sc.slug = 'photo-docs' AND og.slug = 'processing-level'
  );

-- 2. Document types should be free selections for online orders
-- (studio price stays unchanged for in-person service)
UPDATE service_options
SET price_online = 0
WHERE option_group_id = (
    SELECT og.id FROM option_groups og
    JOIN service_categories sc ON sc.id = og.service_category_id
    WHERE sc.slug = 'photo-docs' AND og.slug = 'document-type'
  );

COMMIT;
