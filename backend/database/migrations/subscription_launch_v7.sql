-- =============================================================================
-- SUBSCRIPTION LAUNCH v7 — Стратегия запуска с нуля
-- =============================================================================
-- Контекст: 0 подписчиков, 99 заказов/мес фото на документы, ср. чек 585₽
-- Стратегия: 2 категории, 5 планов (вместо 15 нерелевантных)
-- Фокус: фото на документы (реальный спрос) + печать/скан (low-cost entry)
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- ШАГ 1: Деактивировать ВСЕ текущие планы (15 активных + 13 неактивных)
-- 0 подписчиков → нет риска
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE subscription_plans SET is_active = false, is_popular = false, is_recommended = false, updated_at = now()
WHERE is_active = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- ШАГ 2: Создать новые launch-планы
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
-- КАТЕГОРИЯ 1: photo-docs (ОСНОВНАЯ — под реальный спрос)
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── ПЛАН 1: «Документы Лайт» — entry-point для физлиц ─────────────────
-- Целевая аудитория: физлица, 1-2 визита в месяц на документы
-- Включено: 2x фото на все документы (300₽×2 = 600₽ розница)
--           + 1x подстановка формы (160₽)
-- Розничная стоимость: 760₽
-- Цена подписки: 449₽ (экономия 41%)
-- Себестоимость: ~65₽×2 + ~25₽ = 155₽
-- Маржа при 40% утилизации: 449 - 62 = 387₽ (86%)
-- Маржа при 100% утилизации: 449 - 155 = 294₽ (65%)
INSERT INTO subscription_plans (
  name, slug, description, base_price, is_customizable, min_price,
  billing_period, subscriber_discount_percent, credits_rollover_months,
  is_active, sort_order, features, category, icon,
  savings_label, is_popular, is_recommended
) VALUES (
  'Документы Лайт',
  'launch-docs-lite',
  'Для тех, кому нужны фото на документы 1-2 раза в месяц. 2 комплекта фото + подстановка формы.',
  449.00, false, NULL,
  'monthly', 5, 2,
  true, 10,
  '["2 комплекта фото на документы", "1 подстановка формы", "Скидка 5% на доп. услуги", "Перенос остатка 2 мес"]'::jsonb,
  'photo-docs', 'badge',
  'Экономия 41%', false, false
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  base_price = EXCLUDED.base_price,
  is_customizable = EXCLUDED.is_customizable,
  billing_period = EXCLUDED.billing_period,
  subscriber_discount_percent = EXCLUDED.subscriber_discount_percent,
  credits_rollover_months = EXCLUDED.credits_rollover_months,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order,
  features = EXCLUDED.features,
  category = EXCLUDED.category,
  icon = EXCLUDED.icon,
  savings_label = EXCLUDED.savings_label,
  is_popular = EXCLUDED.is_popular,
  is_recommended = EXCLUDED.is_recommended,
  updated_at = now();

-- ─── ПЛАН 2: «Документы Стандарт» — основной, рекомендуемый ────────────
-- Целевая аудитория: люди с несколькими документами, семьи
-- Включено: 4x фото на все документы (300₽×4 = 1200₽)
--           + 2x подстановка формы (160₽×2 = 320₽)
--           + 1x срочная обработка (160₽)
-- Розничная стоимость: 1680₽
-- Цена подписки: 999₽ (экономия 40%)
-- Себестоимость: ~65₽×4 + ~25₽×2 + ~30₽ = 340₽
-- Маржа при 40% утилизации: 999 - 136 = 863₽ (86%)
-- Маржа при 100% утилизации: 999 - 340 = 659₽ (66%)
INSERT INTO subscription_plans (
  name, slug, description, base_price, is_customizable, min_price,
  billing_period, subscriber_discount_percent, credits_rollover_months,
  is_active, sort_order, features, category, icon,
  savings_label, is_popular, is_recommended
) VALUES (
  'Документы Стандарт',
  'launch-docs-standard',
  'Оптимальный план для семьи. 4 комплекта фото на все документы + подстановка формы + срочная обработка.',
  999.00, false, NULL,
  'monthly', 10, 3,
  true, 20,
  '["4 комплекта фото на документы", "2 подстановки формы", "1 срочная обработка", "Скидка 10% на доп. услуги", "Перенос остатка 3 мес"]'::jsonb,
  'photo-docs', 'photo_camera',
  'Экономия 40%', true, true
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  base_price = EXCLUDED.base_price,
  is_customizable = EXCLUDED.is_customizable,
  billing_period = EXCLUDED.billing_period,
  subscriber_discount_percent = EXCLUDED.subscriber_discount_percent,
  credits_rollover_months = EXCLUDED.credits_rollover_months,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order,
  features = EXCLUDED.features,
  category = EXCLUDED.category,
  icon = EXCLUDED.icon,
  savings_label = EXCLUDED.savings_label,
  is_popular = EXCLUDED.is_popular,
  is_recommended = EXCLUDED.is_recommended,
  updated_at = now();

-- ─── ПЛАН 3: «Документы Про» — для агентств / HR / юристов ─────────────
-- Целевая аудитория: турагенства, HR-отделы, юридические фирмы
-- Включено: 10x фото на все документы (300₽×10 = 3000₽)
--           + 5x подстановка формы (160₽×5 = 800₽)
--           + 2x срочная обработка (160₽×2 = 320₽)
--           + 1x нейро-стандарт (990₽)
-- Розничная стоимость: 5110₽
-- Цена подписки: 2990₽ (экономия 41%)
-- Себестоимость: ~65₽×10 + ~25₽×5 + ~30₽×2 + ~155₽ = 990₽
-- Маржа при 40% утилизации: 2990 - 396 = 2594₽ (87%)
-- Маржа при 100% утилизации: 2990 - 990 = 2000₽ (67%)
INSERT INTO subscription_plans (
  name, slug, description, base_price, is_customizable, min_price,
  billing_period, subscriber_discount_percent, credits_rollover_months,
  is_active, sort_order, features, category, icon,
  savings_label, is_popular, is_recommended
) VALUES (
  'Документы Про',
  'launch-docs-pro',
  'Для турагентств, HR-отделов и юридических фирм. 10 комплектов + нейро-обработка.',
  2990.00, false, NULL,
  'monthly', 15, 3,
  true, 30,
  '["10 комплектов фото на документы", "5 подстановок формы", "2 срочные обработки", "1 нейро-стандарт (4 фото)", "Скидка 15% на доп. услуги", "Перенос остатка 3 мес"]'::jsonb,
  'photo-docs', 'business_center',
  'Экономия 41%', false, false
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  base_price = EXCLUDED.base_price,
  is_customizable = EXCLUDED.is_customizable,
  billing_period = EXCLUDED.billing_period,
  subscriber_discount_percent = EXCLUDED.subscriber_discount_percent,
  credits_rollover_months = EXCLUDED.credits_rollover_months,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order,
  features = EXCLUDED.features,
  category = EXCLUDED.category,
  icon = EXCLUDED.icon,
  savings_label = EXCLUDED.savings_label,
  is_popular = EXCLUDED.is_popular,
  is_recommended = EXCLUDED.is_recommended,
  updated_at = now();

-- ═══════════════════════════════════════════════════════════════════════════
-- КАТЕГОРИЯ 2: print-scan (дополнительная — low-cost entry point)
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── ПЛАН 4: «Печать + Скан Лайт» — студенты, домашние пользователи ────
-- Включено: 50x печать A4 ч/б (6₽×50 = 300₽)
--           + 10x печать A4 цвет (15₽×10 = 150₽)
--           + 30x авто-скан (5₽×30 = 150₽)
-- Розничная стоимость: 600₽
-- Цена подписки: 349₽ (экономия 42%)
-- Себестоимость: 2.25×50 + 2.78×10 + 1.54×30 = 112.5 + 27.8 + 46.2 = 186.5₽
-- Маржа при 40% утилизации: 349 - 74.6 = 274₽ (79%)
-- Маржа при 100% утилизации: 349 - 186.5 = 162.5₽ (47%)
INSERT INTO subscription_plans (
  name, slug, description, base_price, is_customizable, min_price,
  billing_period, subscriber_discount_percent, credits_rollover_months,
  is_active, sort_order, features, category, icon,
  savings_label, is_popular, is_recommended
) VALUES (
  'Печать + Скан Лайт',
  'launch-printscan-lite',
  'Печать документов и сканирование для студентов и домашнего использования.',
  349.00, false, NULL,
  'monthly', 5, 2,
  true, 40,
  '["50 страниц A4 ч/б", "10 страниц A4 цвет", "30 авто-сканов", "Скидка 5% на доп. услуги", "Перенос остатка 2 мес"]'::jsonb,
  'print-scan', 'print',
  'Экономия 42%', true, true
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  base_price = EXCLUDED.base_price,
  is_customizable = EXCLUDED.is_customizable,
  billing_period = EXCLUDED.billing_period,
  subscriber_discount_percent = EXCLUDED.subscriber_discount_percent,
  credits_rollover_months = EXCLUDED.credits_rollover_months,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order,
  features = EXCLUDED.features,
  category = EXCLUDED.category,
  icon = EXCLUDED.icon,
  savings_label = EXCLUDED.savings_label,
  is_popular = EXCLUDED.is_popular,
  is_recommended = EXCLUDED.is_recommended,
  updated_at = now();

-- ─── ПЛАН 5: «Печать + Скан Бизнес» — малый офис ──────────────────────
-- Включено: 200x печать A4 ч/б (6₽×200 = 1200₽)
--           + 30x печать A4 цвет (15₽×30 = 450₽)
--           + 100x авто-скан (5₽×100 = 500₽)
--           + 10x ламинирование A4 (15₽×10 = 150₽)
-- Розничная стоимость: 2300₽
-- Цена подписки: 1390₽ (экономия 40%)
-- Себестоимость: 2.25×200 + 2.78×30 + 1.54×100 + 6.25×10 = 450+83.4+154+62.5 = 749.9₽
-- Маржа при 40% утилизации: 1390 - 300 = 1090₽ (78%)
-- Маржа при 100% утилизации: 1390 - 749.9 = 640₽ (46%)
INSERT INTO subscription_plans (
  name, slug, description, base_price, is_customizable, min_price,
  billing_period, subscriber_discount_percent, credits_rollover_months,
  is_active, sort_order, features, category, icon,
  savings_label, is_popular, is_recommended
) VALUES (
  'Печать + Скан Бизнес',
  'launch-printscan-biz',
  'Для малого офиса: печать, сканирование, ламинирование — всё включено.',
  1390.00, false, NULL,
  'monthly', 10, 3,
  true, 50,
  '["200 страниц A4 ч/б", "30 страниц A4 цвет", "100 авто-сканов", "10 ламинирований A4", "Скидка 10% на доп. услуги", "Перенос остатка 3 мес"]'::jsonb,
  'print-scan', 'print',
  'Экономия 40%', false, false
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  base_price = EXCLUDED.base_price,
  is_customizable = EXCLUDED.is_customizable,
  billing_period = EXCLUDED.billing_period,
  subscriber_discount_percent = EXCLUDED.subscriber_discount_percent,
  credits_rollover_months = EXCLUDED.credits_rollover_months,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order,
  features = EXCLUDED.features,
  category = EXCLUDED.category,
  icon = EXCLUDED.icon,
  savings_label = EXCLUDED.savings_label,
  is_popular = EXCLUDED.is_popular,
  is_recommended = EXCLUDED.is_recommended,
  updated_at = now();

-- ─────────────────────────────────────────────────────────────────────────────
-- ШАГ 3: Привязать plan_items (product inclusions)
-- ─────────────────────────────────────────────────────────────────────────────

-- Удалить старые items для launch-планов (идемпотентность)
DELETE FROM subscription_plan_items WHERE plan_id IN (
  SELECT id FROM subscription_plans WHERE slug LIKE 'launch-%'
);

-- ─── ПЛАН 1: Документы Лайт ────────────────────────────────────────────
-- 2x "На все документы (4 комплекта)" = product_id 4f15d878-...
-- 1x "Подстановка формы" = product_id 139e3e29-...
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, is_required, sort_order) VALUES
  ((SELECT id FROM subscription_plans WHERE slug = 'launch-docs-lite'),
   '4f15d878-7551-4d89-8a6b-89f50db1e754', 2, true, 1),
  ((SELECT id FROM subscription_plans WHERE slug = 'launch-docs-lite'),
   '139e3e29-cdc1-4fbb-9bb6-4330774baa03', 1, false, 2);

-- ─── ПЛАН 2: Документы Стандарт ────────────────────────────────────────
-- 4x "На все документы (4 комплекта)" = 4f15d878
-- 2x "Подстановка формы" = 139e3e29
-- 1x "Срочная (10–15 мин)" = 359a4565
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, is_required, sort_order) VALUES
  ((SELECT id FROM subscription_plans WHERE slug = 'launch-docs-standard'),
   '4f15d878-7551-4d89-8a6b-89f50db1e754', 4, true, 1),
  ((SELECT id FROM subscription_plans WHERE slug = 'launch-docs-standard'),
   '139e3e29-cdc1-4fbb-9bb6-4330774baa03', 2, false, 2),
  ((SELECT id FROM subscription_plans WHERE slug = 'launch-docs-standard'),
   '359a4565-83b7-4120-bc06-2f4ea5a6efaf', 1, false, 3);

-- ─── ПЛАН 3: Документы Про ─────────────────────────────────────────────
-- 10x "На все документы (4 комплекта)" = 4f15d878
-- 5x "Подстановка формы" = 139e3e29
-- 2x "Срочная (10–15 мин)" = 359a4565
-- 1x "Стандарт (4 фото)" нейро = b0eb8f69
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, is_required, sort_order) VALUES
  ((SELECT id FROM subscription_plans WHERE slug = 'launch-docs-pro'),
   '4f15d878-7551-4d89-8a6b-89f50db1e754', 10, true, 1),
  ((SELECT id FROM subscription_plans WHERE slug = 'launch-docs-pro'),
   '139e3e29-cdc1-4fbb-9bb6-4330774baa03', 5, false, 2),
  ((SELECT id FROM subscription_plans WHERE slug = 'launch-docs-pro'),
   '359a4565-83b7-4120-bc06-2f4ea5a6efaf', 2, false, 3),
  ((SELECT id FROM subscription_plans WHERE slug = 'launch-docs-pro'),
   'b0eb8f69-22bc-4cdd-a15f-f4f9848dbc4a', 1, false, 4);

-- ─── ПЛАН 4: Печать + Скан Лайт ───────────────────────────────────────
-- 50x "Печать A4 ч/б" = a2000001-...-0001
-- 10x "Печать A4 цвет" = a2000001-...-0002
-- 30x "Авто-скан документа" = a1000001-...-0001
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, is_required, sort_order) VALUES
  ((SELECT id FROM subscription_plans WHERE slug = 'launch-printscan-lite'),
   'a2000001-0000-0000-0000-000000000001', 50, true, 1),
  ((SELECT id FROM subscription_plans WHERE slug = 'launch-printscan-lite'),
   'a2000001-0000-0000-0000-000000000002', 10, false, 2),
  ((SELECT id FROM subscription_plans WHERE slug = 'launch-printscan-lite'),
   'a1000001-0000-0000-0000-000000000001', 30, false, 3);

-- ─── ПЛАН 5: Печать + Скан Бизнес ─────────────────────────────────────
-- 200x "Печать A4 ч/б" = a2000001-...-0001
-- 30x "Печать A4 цвет" = a2000001-...-0002
-- 100x "Авто-скан документа" = a1000001-...-0001
-- 10x "Ламинирование A4" = 25ad33fd
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, is_required, sort_order) VALUES
  ((SELECT id FROM subscription_plans WHERE slug = 'launch-printscan-biz'),
   'a2000001-0000-0000-0000-000000000001', 200, true, 1),
  ((SELECT id FROM subscription_plans WHERE slug = 'launch-printscan-biz'),
   'a2000001-0000-0000-0000-000000000002', 30, false, 2),
  ((SELECT id FROM subscription_plans WHERE slug = 'launch-printscan-biz'),
   'a1000001-0000-0000-0000-000000000001', 100, false, 3),
  ((SELECT id FROM subscription_plans WHERE slug = 'launch-printscan-biz'),
   '25ad33fd-04cd-4aa4-88f5-051341f50632', 10, false, 4);

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- ВЕРИФИКАЦИЯ
-- ─────────────────────────────────────────────────────────────────────────────
SELECT '=== АКТИВНЫЕ ПЛАНЫ ===' as section;
SELECT sp.name, sp.slug, sp.category, sp.base_price, sp.billing_period, sp.is_popular, sp.is_recommended, sp.savings_label
FROM subscription_plans sp WHERE sp.is_active = true ORDER BY sp.sort_order;

SELECT '=== PLAN ITEMS ===' as section;
SELECT sp.name as plan, p.name as product, spi.included_quantity as qty,
  p.sell_price, (p.sell_price * spi.included_quantity)::numeric(10,2) as retail_value
FROM subscription_plan_items spi
JOIN subscription_plans sp ON sp.id = spi.plan_id
JOIN products p ON p.id = spi.product_id
WHERE sp.is_active = true
ORDER BY sp.sort_order, spi.sort_order;

SELECT '=== ИТОГО РОЗНИЧНАЯ СТОИМОСТЬ ===' as section;
SELECT sp.name, sp.base_price as subscription_price,
  SUM(p.sell_price * spi.included_quantity)::numeric(10,2) as retail_value,
  (100 - (sp.base_price / SUM(p.sell_price * spi.included_quantity) * 100))::numeric(5,1) as savings_percent
FROM subscription_plan_items spi
JOIN subscription_plans sp ON sp.id = spi.plan_id
JOIN products p ON p.id = spi.product_id
WHERE sp.is_active = true
GROUP BY sp.id, sp.name, sp.base_price, sp.sort_order
ORDER BY sp.sort_order;

SELECT '=== ДЕАКТИВИРОВАННЫЕ ПЛАНЫ ===' as section;
SELECT COUNT(*) as deactivated_count FROM subscription_plans WHERE is_active = false;
