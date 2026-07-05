-- Subscription landing page fix: sort_order, features, is_popular
-- Fixes: wrong card ordering, non-customer-facing product descriptions, popularity badges

BEGIN;

-- Fix sort_order: cheapest first (10, 20, 30) within each category
UPDATE subscription_plans SET sort_order = 10 WHERE slug = 'launch-printscan-lite';
UPDATE subscription_plans SET sort_order = 20 WHERE slug = 'launch-printscan-biz';
UPDATE subscription_plans SET sort_order = 30 WHERE slug = 'launch-printscan-pro';

UPDATE subscription_plans SET sort_order = 10 WHERE slug = 'launch-docs-lite';
UPDATE subscription_plans SET sort_order = 20 WHERE slug = 'launch-docs-agent';
UPDATE subscription_plans SET sort_order = 30 WHERE slug = 'launch-docs-agency';

UPDATE subscription_plans SET sort_order = 10 WHERE slug = 'launch-photoprint-lite';
UPDATE subscription_plans SET sort_order = 20 WHERE slug = 'launch-photoprint-standard';
UPDATE subscription_plans SET sort_order = 30 WHERE slug = 'launch-photoprint-pro';

-- Fix is_popular + is_recommended: 199₽ entry plans are the focus
UPDATE subscription_plans SET is_popular = true, is_recommended = true WHERE slug IN (
  'launch-printscan-lite', 'launch-docs-lite', 'launch-photoprint-lite'
);
UPDATE subscription_plans SET is_popular = false, is_recommended = false WHERE slug IN (
  'launch-printscan-biz', 'launch-printscan-pro',
  'launch-docs-agent', 'launch-docs-agency',
  'launch-photoprint-standard', 'launch-photoprint-pro'
);

-- Fix features JSONB: customer-facing descriptions
-- Doc-print category
UPDATE subscription_plans SET features = '["80 страниц A4 ч/б в месяц", "Перенос остатка до 3 месяцев", "Скидка 5% на цветную печать и ламинацию"]'::jsonb
WHERE slug = 'launch-printscan-lite';

UPDATE subscription_plans SET features = '["250 страниц A4 ч/б в месяц", "Скидка 10% на всё сверх лимита", "Перенос остатка до 3 месяцев", "Цветная печать и ламинация со скидкой 10%"]'::jsonb
WHERE slug = 'launch-printscan-biz';

UPDATE subscription_plans SET features = '["800 страниц A4 ч/б в месяц", "Скидка 15% на всё сверх лимита", "Перенос остатка до 3 месяцев", "Цветная печать, скан, ламинация со скидкой 15%"]'::jsonb
WHERE slug = 'launch-printscan-pro';

-- Photo-docs category
UPDATE subscription_plans SET features = '["2 комплекта фото на любые документы", "1 подстановка формы", "Перенос остатка до 3 месяцев", "Скидка 5% на доп. услуги"]'::jsonb
WHERE slug = 'launch-docs-lite';

UPDATE subscription_plans SET features = '["5 комплектов фото на любые документы", "Скидка 10% на обработку, формы, срочные", "Перенос остатка до 3 месяцев"]'::jsonb
WHERE slug = 'launch-docs-agent';

UPDATE subscription_plans SET features = '["15 комплектов фото на любые документы", "Скидка 15% на обработку, формы, срочные", "Перенос остатка до 3 месяцев", "Приоритетная запись без очереди"]'::jsonb
WHERE slug = 'launch-docs-agency';

-- Photo-print category
UPDATE subscription_plans SET features = '["15 фото 10×15 Premium в месяц", "Перенос остатка до 3 месяцев", "Скидка 5% на крупные форматы"]'::jsonb
WHERE slug = 'launch-photoprint-lite';

UPDATE subscription_plans SET features = '["80 фото 10×15 Premium в месяц", "Скидка 10% на крупные форматы", "Перенос остатка до 3 месяцев"]'::jsonb
WHERE slug = 'launch-photoprint-standard';

UPDATE subscription_plans SET features = '["200 фото 10×15 Premium в месяц", "Скидка 15% на все форматы сверх лимита", "Перенос остатка до 3 месяцев"]'::jsonb
WHERE slug = 'launch-photoprint-pro';

-- Fix Документы Лайт: item quantity should be 2 (matching features "2 комплекта")
UPDATE subscription_plan_items SET included_quantity = 2
WHERE plan_id = (SELECT id FROM subscription_plans WHERE slug = 'launch-docs-lite');

-- Fix savings_label for consistency
UPDATE subscription_plans SET savings_label = 'Экономия 58%' WHERE slug = 'launch-printscan-lite';
UPDATE subscription_plans SET savings_label = 'Экономия 54%' WHERE slug = 'launch-printscan-biz';
UPDATE subscription_plans SET savings_label = 'Экономия 59%' WHERE slug = 'launch-printscan-pro';
UPDATE subscription_plans SET savings_label = 'Экономия 80%' WHERE slug = 'launch-docs-lite';
UPDATE subscription_plans SET savings_label = 'Экономия 57%' WHERE slug = 'launch-docs-agent';
UPDATE subscription_plans SET savings_label = 'Экономия 52%' WHERE slug = 'launch-docs-agency';
UPDATE subscription_plans SET savings_label = 'Экономия 32%' WHERE slug = 'launch-photoprint-lite';
UPDATE subscription_plans SET savings_label = 'Экономия 37%' WHERE slug = 'launch-photoprint-standard';
UPDATE subscription_plans SET savings_label = 'Экономия 54%' WHERE slug = 'launch-photoprint-pro';

COMMIT;
