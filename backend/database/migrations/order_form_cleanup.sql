-- Order form cleanup: rename processing levels to match retouch category prices
-- Idempotent (safe to re-run)

BEGIN;

-- 1. Deactivate "Экспресс" (slug=basic) for photo-docs processing-level
--    It's price_studio=0, useless in CRM form
UPDATE service_options
SET is_active = false
WHERE slug = 'basic'
  AND option_group_id = (
    SELECT og.id FROM option_groups og
    JOIN service_categories sc ON og.service_category_id = sc.id
    WHERE og.slug = 'processing-level' AND sc.slug = 'photo-docs'
  );

-- 2. Rename + fix prices to match retouch category (Базовая/Профессиональная/Премиальная)
--    Профессиональный (600₽) → Базовая (600₽) — name only
UPDATE service_options
SET name = 'Базовая'
WHERE slug = 'retouch'
  AND option_group_id = (
    SELECT og.id FROM option_groups og
    JOIN service_categories sc ON og.service_category_id = sc.id
    WHERE og.slug = 'processing-level' AND sc.slug = 'photo-docs'
  );

--    Премиум (700₽) → Профессиональная (900₽) — name + price
UPDATE service_options
SET name = 'Профессиональная', price_studio = 900
WHERE slug = 'vip'
  AND option_group_id = (
    SELECT og.id FROM option_groups og
    JOIN service_categories sc ON og.service_category_id = sc.id
    WHERE og.slug = 'processing-level' AND sc.slug = 'photo-docs'
  );

--    VIP «Все документы» (2490₽) → Премиальная (1400₽) — name + price
UPDATE service_options
SET name = 'Премиальная', price_studio = 1400
WHERE slug = 'vip-all-docs'
  AND option_group_id = (
    SELECT og.id FROM option_groups og
    JOIN service_categories sc ON og.service_category_id = sc.id
    WHERE og.slug = 'processing-level' AND sc.slug = 'photo-docs'
  );

-- 3. Sort order
UPDATE service_options SET sort_order = 1
WHERE slug = 'retouch' AND option_group_id = (
  SELECT og.id FROM option_groups og JOIN service_categories sc ON og.service_category_id = sc.id
  WHERE og.slug = 'processing-level' AND sc.slug = 'photo-docs');

UPDATE service_options SET sort_order = 2
WHERE slug = 'vip' AND option_group_id = (
  SELECT og.id FROM option_groups og JOIN service_categories sc ON og.service_category_id = sc.id
  WHERE og.slug = 'processing-level' AND sc.slug = 'photo-docs');

UPDATE service_options SET sort_order = 3
WHERE slug = 'vip-all-docs' AND option_group_id = (
  SELECT og.id FROM option_groups og JOIN service_categories sc ON og.service_category_id = sc.id
  WHERE og.slug = 'processing-level' AND sc.slug = 'photo-docs');

COMMIT;
