-- Sync pricing engine (service_options.price_studio) with real POS prices from Kontur.Market
-- Source of truth: products.sell_price (imported from Kontur.Market)

BEGIN;

-- 1. Fix price mismatches: pricing engine had inflated online prices in price_studio
-- Подстановка формы: 290 → 160
UPDATE service_options SET price_studio = 160, updated_at = now()
WHERE slug = 'uniform' AND price_studio = 290;

-- Срочная (1 час): 290 → 160
UPDATE service_options SET price_studio = 160, updated_at = now()
WHERE slug = 'urgent' AND price_studio = 290
  AND option_group_id IN (
    SELECT og.id FROM option_groups og
    JOIN service_categories sc ON sc.id = og.service_category_id
    WHERE sc.slug = 'photo-docs'
  );

-- На все документы (4 комплекта): 490 → 300
UPDATE service_options SET price_studio = 300, updated_at = now()
WHERE slug = 'all-docs-bundle' AND price_studio = 490;

-- Печать + доставка: 290 → 200
UPDATE service_options SET price_studio = 200, updated_at = now()
WHERE slug = 'print-delivery' AND price_studio = 290;

-- 2. Also fix Убрать бороду if it differs (check products table)
-- Убрать бороду: keep at 490 (not in products table, so pricing engine is source)

COMMIT;
