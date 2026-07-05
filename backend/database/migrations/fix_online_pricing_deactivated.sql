-- Fix: POS catalog reorganization accidentally deactivated online pricing options
-- Cause: commit 2c8efbf5 (reorganize POS catalog) set is_active=false on online-facing options
-- Affected pages: /voennaya-retush (entire category), /foto-na-documenty-online (processing-level, speed, extras)

BEGIN;

-- 1. Reactivate voennaya-retush category (was deactivated during POS reorganization)
UPDATE service_categories
SET is_active = true, updated_at = now()
WHERE slug = 'voennaya-retush' AND is_active = false;

-- 1b. Reactivate option GROUPS for photo-docs (processing-level, speed, extras)
UPDATE option_groups SET is_active = true, updated_at = now()
WHERE slug IN ('processing-level', 'speed', 'extras')
  AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'photo-docs')
  AND is_active = false;

-- 1c. Reactivate ALL option GROUPS for voennaya-retush
UPDATE option_groups SET is_active = true, updated_at = now()
WHERE service_category_id = (SELECT id FROM service_categories WHERE slug = 'voennaya-retush')
  AND slug != 'km-studio'
  AND is_active = false;

-- 2. Reactivate online processing-level options in photo-docs
UPDATE service_options
SET is_active = true, updated_at = now()
WHERE slug IN ('basic', 'retouch', 'vip', 'vip-all-docs')
  AND option_group_id IN (
    SELECT og.id FROM option_groups og
    JOIN service_categories sc ON sc.id = og.service_category_id
    WHERE sc.slug = 'photo-docs' AND og.slug = 'processing-level'
  )
  AND is_active = false;

-- 3. Reactivate speed options in photo-docs
UPDATE service_options
SET is_active = true, updated_at = now()
WHERE slug IN ('normal', 'urgent')
  AND option_group_id IN (
    SELECT og.id FROM option_groups og
    JOIN service_categories sc ON sc.id = og.service_category_id
    WHERE sc.slug = 'photo-docs' AND og.slug = 'speed'
  )
  AND is_active = false;

-- 4. Reactivate extras options in photo-docs
UPDATE service_options
SET is_active = true, updated_at = now()
WHERE slug IN ('uniform', 'beard-removal', 'all-docs-bundle', 'print-delivery')
  AND option_group_id IN (
    SELECT og.id FROM option_groups og
    JOIN service_categories sc ON sc.id = og.service_category_id
    WHERE sc.slug = 'photo-docs' AND og.slug = 'extras'
  )
  AND is_active = false;

-- 5. Reactivate original document-type options (with price_online)
UPDATE service_options
SET is_active = true, updated_at = now()
WHERE slug IN ('passport-rf', 'passport-zagran', 'photo-student')
  AND option_group_id IN (
    SELECT og.id FROM option_groups og
    JOIN service_categories sc ON sc.id = og.service_category_id
    WHERE sc.slug = 'photo-docs' AND og.slug = 'document-type'
  )
  AND is_active = false;

-- 6. Deactivate km-* duplicates (POS-only, no price_online, duplicate document-type entries)
UPDATE service_options
SET is_active = false, updated_at = now()
WHERE slug IN ('km-фото-на-паспорт', 'km-фото-на-загран')
  AND option_group_id IN (
    SELECT og.id FROM option_groups og
    JOIN service_categories sc ON sc.id = og.service_category_id
    WHERE sc.slug = 'photo-docs' AND og.slug = 'document-type'
  )
  AND is_active = true;

-- 7. Deactivate POS-only items that don't belong in online configurator
UPDATE service_options
SET is_active = false, updated_at = now()
WHERE slug IN ('urgent-photo-docs', 'portrait-business', 'studio-retouch')
  AND option_group_id IN (
    SELECT og.id FROM option_groups og
    JOIN service_categories sc ON sc.id = og.service_category_id
    WHERE sc.slug = 'photo-docs'
  )
  AND is_active = true;

-- 8. Deactivate km-studio group options (POS-only, sort_order=99)
UPDATE service_options
SET is_active = false, updated_at = now()
WHERE option_group_id IN (
    SELECT og.id FROM option_groups og
    JOIN service_categories sc ON sc.id = og.service_category_id
    WHERE sc.slug = 'photo-docs' AND og.slug = 'km-studio'
  )
  AND is_active = true;

COMMIT;
