-- Subscription Lineup v2: 3 категории × 3 тарифа, чистая базовая услуга
-- Философия: подписка = объём базовой услуги, допы платно со скидкой подписчика
-- Applied: 2026-03-27

BEGIN;

-- 1. Деактивировать устаревшие планы
UPDATE subscription_plans SET is_active = false, updated_at = now()
WHERE slug IN (
  'launch-scan-lite', 'launch-scan-biz',           -- scan → влита в print
  'launch-docs-standard', 'launch-docs-pro',        -- → B2B тиры
  'launch-retouch-standard', 'launch-retouch-pro',  -- мёртвые продукты
  'launch-retouch-lite',                             -- экономия 1₽
  'launch-retouch-lite-v2', 'launch-retouch-standard-v2', 'launch-retouch-pro-v2' -- не продуманы
) AND is_active = true;

-- 2. Документы Агент 1490₽: 5 комплектов (допы платно)
INSERT INTO subscription_plans (name, slug, category, base_price, billing_period, is_active, is_popular, description, features, credits_rollover_months, subscriber_discount_percent, sort_order)
SELECT 'Документы Агент', 'launch-docs-agent', 'photo-docs', 1490, 'monthly', true, true,
  '5 комплектов фото на документы — для посредников и агентов',
  '["5 комплектов фото на документы","Обработка, формы, срочная — по прайсу со скидкой 10%"]', 3, 10, 2
WHERE NOT EXISTS (SELECT 1 FROM subscription_plans WHERE slug = 'launch-docs-agent');

DELETE FROM subscription_plan_items WHERE plan_id = (SELECT id FROM subscription_plans WHERE slug = 'launch-docs-agent');
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, sort_order)
SELECT sp.id, p.id, 5, 1 FROM subscription_plans sp, products p
WHERE sp.slug = 'launch-docs-agent' AND p.code = 'basic';

-- 3. Документы Агентство 4990₽: 15 комплектов
INSERT INTO subscription_plans (name, slug, category, base_price, billing_period, is_active, description, features, credits_rollover_months, subscriber_discount_percent, sort_order)
SELECT 'Документы Агентство', 'launch-docs-agency', 'photo-docs', 4990, 'monthly', true,
  '15 комплектов — для агентств и HR-отделов',
  '["15 комплектов фото на документы","Обработка, формы, срочная — по прайсу со скидкой 15%"]', 3, 15, 3
WHERE NOT EXISTS (SELECT 1 FROM subscription_plans WHERE slug = 'launch-docs-agency');

DELETE FROM subscription_plan_items WHERE plan_id = (SELECT id FROM subscription_plans WHERE slug = 'launch-docs-agency');
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, sort_order)
SELECT sp.id, p.id, 15, 1 FROM subscription_plans sp, products p
WHERE sp.slug = 'launch-docs-agency' AND p.code = 'basic';

-- 4. Фотопечать: только 10×15, крупные форматы = допы
UPDATE subscription_plans SET base_price = 990,
  features = '["80 фото 10×15 Premium","Крупные форматы — по прайсу со скидкой 10%"]',
  updated_at = now()
WHERE slug = 'launch-photoprint-standard';

DELETE FROM subscription_plan_items WHERE plan_id = (SELECT id FROM subscription_plans WHERE slug = 'launch-photoprint-standard');
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, sort_order)
SELECT sp.id, p.id, 80, 1 FROM subscription_plans sp, products p
WHERE sp.slug = 'launch-photoprint-standard' AND p.name = 'Фотобумага 10x15 Premium';

UPDATE subscription_plans SET base_price = 1790,
  features = '["200 фото 10×15 Premium","Крупные форматы — по прайсу со скидкой 15%"]',
  updated_at = now()
WHERE slug = 'launch-photoprint-pro';

DELETE FROM subscription_plan_items WHERE plan_id = (SELECT id FROM subscription_plans WHERE slug = 'launch-photoprint-pro');
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, sort_order)
SELECT sp.id, p.id, 200, 1 FROM subscription_plans sp, products p
WHERE sp.slug = 'launch-photoprint-pro' AND p.name = 'Фотобумага 10x15 Premium';

-- 5. Печать: только A4 ч/б, цвет/скан/ламинация = допы
UPDATE subscription_plans SET name = 'Печать Лайт', category = 'print',
  features = '["80 страниц A4 ч/б","Цвет, скан, ламинация — по прайсу со скидкой 5%"]',
  updated_at = now()
WHERE slug = 'launch-printscan-lite';

DELETE FROM subscription_plan_items WHERE plan_id = (SELECT id FROM subscription_plans WHERE slug = 'launch-printscan-lite');
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, sort_order)
SELECT sp.id, 'a2000001-0000-0000-0000-000000000001'::uuid, 80, 1
FROM subscription_plans sp WHERE sp.slug = 'launch-printscan-lite';

UPDATE subscription_plans SET name = 'Печать Бизнес', base_price = 690, category = 'print',
  features = '["250 страниц A4 ч/б","Цвет, скан, ламинация — по прайсу со скидкой 10%"]',
  updated_at = now()
WHERE slug = 'launch-printscan-biz';

DELETE FROM subscription_plan_items WHERE plan_id = (SELECT id FROM subscription_plans WHERE slug = 'launch-printscan-biz');
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, sort_order)
SELECT sp.id, 'a2000001-0000-0000-0000-000000000001'::uuid, 250, 1
FROM subscription_plans sp WHERE sp.slug = 'launch-printscan-biz';

INSERT INTO subscription_plans (name, slug, category, base_price, billing_period, is_active, description, features, credits_rollover_months, subscriber_discount_percent, sort_order)
SELECT 'Печать Про', 'launch-printscan-pro', 'print', 1990, 'monthly', true,
  '800 страниц A4 ч/б для офиса',
  '["800 страниц A4 ч/б","Цвет, скан, ламинация — по прайсу со скидкой 15%"]', 3, 15, 3
WHERE NOT EXISTS (SELECT 1 FROM subscription_plans WHERE slug = 'launch-printscan-pro');

DELETE FROM subscription_plan_items WHERE plan_id = (SELECT id FROM subscription_plans WHERE slug = 'launch-printscan-pro');
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, sort_order)
SELECT sp.id, 'a2000001-0000-0000-0000-000000000001'::uuid, 800, 1
FROM subscription_plans sp WHERE sp.slug = 'launch-printscan-pro';

COMMIT;
