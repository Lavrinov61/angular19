-- =====================================================
-- Subscription Plans v3 Cleanup
-- Deactivate 13 old plans, create 15 new (5 categories x 3 tiers)
-- 0 subscribers, 0 credits — safe migration
-- Idempotent: safe to run multiple times
-- =====================================================

BEGIN;

-- =====================================================
-- STEP 1: Deactivate all existing active plans
-- =====================================================
UPDATE subscription_plans
SET is_active = false, updated_at = NOW()
WHERE is_active = true;

-- =====================================================
-- STEP 2: Create missing products for scan & retouch
-- =====================================================

-- Scan products
INSERT INTO products (id, name, code, product_type, unit, sell_price, is_active, is_subscription_eligible, category_id)
VALUES
  ('a1000001-0000-0000-0000-000000000001', 'Авто-скан документа', 'scan-auto', 'service', 'piece', 5.00, true, true,
    (SELECT id FROM product_categories WHERE name = 'Услуги' LIMIT 1)),
  ('a1000001-0000-0000-0000-000000000002', 'Ручное сканирование', 'scan-manual', 'service', 'piece', 20.00, true, true,
    (SELECT id FROM product_categories WHERE name = 'Услуги' LIMIT 1)),
  ('a1000001-0000-0000-0000-000000000003', 'Кадрирование скана', 'scan-crop', 'service', 'piece', 15.00, true, true,
    (SELECT id FROM product_categories WHERE name = 'Услуги' LIMIT 1))
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  code = EXCLUDED.code,
  sell_price = EXCLUDED.sell_price,
  is_subscription_eligible = true,
  updated_at = NOW();

-- Retouch products
INSERT INTO products (id, name, code, product_type, unit, sell_price, is_active, is_subscription_eligible, category_id)
VALUES
  ('a1000002-0000-0000-0000-000000000001', 'Ретушь простая', 'retouch-simple', 'service', 'piece', 50.00, true, true,
    (SELECT id FROM product_categories WHERE name = 'Ретушь Базовая' LIMIT 1)),
  ('a1000002-0000-0000-0000-000000000002', 'Ретушь базовая', 'retouch-basic', 'service', 'piece', 150.00, true, true,
    (SELECT id FROM product_categories WHERE name = 'Ретушь Базовая' LIMIT 1)),
  ('a1000002-0000-0000-0000-000000000003', 'Ретушь репортажная', 'retouch-reportage', 'service', 'piece', 200.00, true, true,
    (SELECT id FROM product_categories WHERE name = 'Ретушь Профессиональная' LIMIT 1)),
  ('a1000002-0000-0000-0000-000000000004', 'Ретушь профессиональная', 'retouch-professional', 'service', 'piece', 500.00, true, true,
    (SELECT id FROM product_categories WHERE name = 'Ретушь Премиальная' LIMIT 1))
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  code = EXCLUDED.code,
  sell_price = EXCLUDED.sell_price,
  is_subscription_eligible = true,
  updated_at = NOW();

-- Mark existing products used in subscriptions as eligible
UPDATE products SET is_subscription_eligible = true, updated_at = NOW()
WHERE id IN (
  '71b5eabc-f00a-434a-a0fe-9db001a79bbb', -- Бумага A4 80g офисная
  'bebafbfe-3900-45f1-9ec4-2a2da2860a81', -- Бумага A4 глянцевая 150g
  '4c2f07f5-6e29-43f6-ae5e-6712379ecd83', -- Бумага A4 матовая 120g (цвет)
  '95801867-e56d-4d4c-96c4-08ee9b14d3aa', -- Бумага A3 80g офисная
  '81476759-8e40-4d50-a15b-556f3f8a3368', -- Фотобумага 10x15 Premium
  '66848433-f5e8-4aaa-ae00-fe0705ad2f31', -- Фотобумага 15x21 Premium
  '9d710edb-0cfd-4419-8aed-f6b59986bc1b', -- Фотобумага 21x30 (A4) Premium
  '80b3d641-d2ce-475a-a74c-8003f05f1eca', -- Фотобумага 30x40 Premium
  '4f15d878-7551-4d89-8a6b-89f50db1e754', -- На все документы (4 комплекта)
  '139e3e29-cdc1-4fbb-9bb6-4330774baa03', -- Подстановка формы
  'b0eb8f69-22bc-4cdd-a15f-f4f9848dbc4a', -- Стандарт (4 фото) / нейро-стандарт
  '8479ccc3-d5e0-4d83-aeaf-6204f7f2b088', -- Полная (10–15 фото) / нейро-полная
  '359a4565-83b7-4120-bc06-2f4ea5a6efaf', -- Срочная (10–15 мин)
  '25ad33fd-04cd-4aa4-88f5-051341f50632'  -- Плёнка для ламинации
);

-- =====================================================
-- STEP 3: Insert 15 new subscription plans
-- =====================================================

-- === Печать документов (doc-print) ===

INSERT INTO subscription_plans (slug, name, description, category, icon, base_price, subscriber_discount_percent, credits_rollover_months, billing_period, is_active, sort_order, is_popular, is_customizable, features)
VALUES
  ('doc-print-student', 'Студент', 'Базовый пакет для студентов: ч/б и цветная печать A4', 'doc-print', 'print', 199.00, 15.00, 3, 'monthly', true, 10, false, true, '["100 стр A4 ч/б", "10 стр A4 цвет", "Скидка 15% сверх лимита"]'::jsonb),
  ('doc-print-business', 'Бизнес', 'Для малого бизнеса: A4, A3 печать с экономией 20%', 'doc-print', 'print', 899.00, 20.00, 3, 'monthly', true, 20, true, true, '["300 стр A4 ч/б", "30 стр A4 цвет", "10 стр A3", "Скидка 20% сверх лимита"]'::jsonb),
  ('doc-print-office', 'Офис', 'Полный офисный пакет: A4, A3, глянец, максимальная скидка', 'doc-print', 'print', 2490.00, 30.00, 3, 'monthly', true, 30, false, true, '["800 стр A4 ч/б", "80 стр A4 цвет", "30 стр A3", "10 стр глянец", "Скидка 30% сверх лимита"]'::jsonb)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  icon = EXCLUDED.icon,
  base_price = EXCLUDED.base_price,
  subscriber_discount_percent = EXCLUDED.subscriber_discount_percent,
  credits_rollover_months = EXCLUDED.credits_rollover_months,
  billing_period = EXCLUDED.billing_period,
  is_active = true,
  sort_order = EXCLUDED.sort_order,
  is_popular = EXCLUDED.is_popular,
  is_customizable = EXCLUDED.is_customizable,
  features = EXCLUDED.features,
  updated_at = NOW();

-- === Фотопечать (photo-print) ===

INSERT INTO subscription_plans (slug, name, description, category, icon, base_price, subscriber_discount_percent, credits_rollover_months, billing_period, is_active, sort_order, is_popular, is_customizable, features)
VALUES
  ('photo-print-fan', 'Любитель', 'Для фотолюбителей: печать 10x15 и 15x21', 'photo-print', 'photo_camera', 249.00, 10.00, 3, 'monthly', true, 10, false, true, '["20 фото 10x15", "3 фото 15x21", "Скидка 10% сверх лимита"]'::jsonb),
  ('photo-print-family', 'Семейный', 'Семейный пакет: от 10x15 до 21x30', 'photo-print', 'photo_camera', 599.00, 15.00, 3, 'monthly', true, 20, true, true, '["40 фото 10x15", "8 фото 15x21", "2 фото 21x30", "Скидка 15% сверх лимита"]'::jsonb),
  ('photo-print-pro', 'Фотограф', 'Для профессионалов: все форматы до 30x40', 'photo-print', 'photo_camera', 1290.00, 20.00, 3, 'monthly', true, 30, false, true, '["80 фото 10x15", "15 фото 15x21", "5 фото 21x30", "2 фото 30x40", "Скидка 20% сверх лимита"]'::jsonb)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  icon = EXCLUDED.icon,
  base_price = EXCLUDED.base_price,
  subscriber_discount_percent = EXCLUDED.subscriber_discount_percent,
  credits_rollover_months = EXCLUDED.credits_rollover_months,
  billing_period = EXCLUDED.billing_period,
  is_active = true,
  sort_order = EXCLUDED.sort_order,
  is_popular = EXCLUDED.is_popular,
  is_customizable = EXCLUDED.is_customizable,
  features = EXCLUDED.features,
  updated_at = NOW();

-- === Сканирование (scan) ===

INSERT INTO subscription_plans (slug, name, description, category, icon, base_price, subscriber_discount_percent, credits_rollover_months, billing_period, is_active, sort_order, is_popular, is_customizable, features)
VALUES
  ('scan-lite', 'Архив Лайт', 'Базовое сканирование: авто-скан и ручное', 'scan', 'scanner', 299.00, 10.00, 3, 'monthly', true, 10, false, true, '["100 авто-сканов", "5 ручных сканов", "Скидка 10% сверх лимита"]'::jsonb),
  ('scan-pro', 'Архив Про', 'Расширенный пакет: авто, ручное, кадрирование', 'scan', 'scanner', 799.00, 15.00, 3, 'monthly', true, 20, true, true, '["300 авто-сканов", "20 ручных сканов", "10 кадрирований", "Скидка 15% сверх лимита"]'::jsonb),
  ('scan-biz', 'Архив Бизнес', 'Полный бизнес-пакет: все виды сканирования + ламинация', 'scan', 'scanner', 1990.00, 25.00, 3, 'monthly', true, 30, false, true, '["500 авто-сканов", "30 ручных сканов", "20 кадрирований", "10 ламинирований", "Скидка 25% сверх лимита"]'::jsonb)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  icon = EXCLUDED.icon,
  base_price = EXCLUDED.base_price,
  subscriber_discount_percent = EXCLUDED.subscriber_discount_percent,
  credits_rollover_months = EXCLUDED.credits_rollover_months,
  billing_period = EXCLUDED.billing_period,
  is_active = true,
  sort_order = EXCLUDED.sort_order,
  is_popular = EXCLUDED.is_popular,
  is_customizable = EXCLUDED.is_customizable,
  features = EXCLUDED.features,
  updated_at = NOW();

-- === Фото на документы (photo-docs) ===

INSERT INTO subscription_plans (slug, name, description, category, icon, base_price, subscriber_discount_percent, credits_rollover_months, billing_period, is_active, sort_order, is_popular, is_customizable, features)
VALUES
  ('photo-docs-agent', 'Агент', 'Для агентов: комплекты + подстановка + нейро', 'photo-docs', 'badge', 1990.00, 10.00, 3, 'monthly', true, 10, false, true, '["5 комплектов", "2 подстановки формы", "1 нейро-стандарт", "Скидка 10% сверх лимита"]'::jsonb),
  ('photo-docs-agency', 'Агентство', 'Для агентств: расширенный набор с нейро-обработкой', 'photo-docs', 'badge', 5990.00, 15.00, 3, 'monthly', true, 20, true, true, '["12 комплектов", "6 подстановок формы", "3 нейро-стандарт", "1 нейро-полный", "Скидка 15% сверх лимита"]'::jsonb),
  ('photo-docs-corp', 'Корпорат', 'Корпоративный пакет: максимальный объём + срочные', 'photo-docs', 'badge', 12900.00, 25.00, 3, 'monthly', true, 30, false, true, '["25 комплектов", "15 подстановок формы", "5 нейро-стандарт", "2 нейро-полных", "2 срочных", "Скидка 25% сверх лимита"]'::jsonb)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  icon = EXCLUDED.icon,
  base_price = EXCLUDED.base_price,
  subscriber_discount_percent = EXCLUDED.subscriber_discount_percent,
  credits_rollover_months = EXCLUDED.credits_rollover_months,
  billing_period = EXCLUDED.billing_period,
  is_active = true,
  sort_order = EXCLUDED.sort_order,
  is_popular = EXCLUDED.is_popular,
  is_customizable = EXCLUDED.is_customizable,
  features = EXCLUDED.features,
  updated_at = NOW();

-- === Ретушь (retouch) ===

INSERT INTO subscription_plans (slug, name, description, category, icon, base_price, subscriber_discount_percent, credits_rollover_months, billing_period, is_active, sort_order, is_popular, is_customizable, features)
VALUES
  ('retouch-fan', 'Фотолюбитель', 'Базовая ретушь для любителей', 'retouch', 'auto_fix_high', 490.00, 10.00, 3, 'monthly', true, 10, false, true, '["5 простых ретушей", "1 базовая ретушь", "Скидка 10% сверх лимита"]'::jsonb),
  ('retouch-pro', 'Фотограф', 'Профессиональный пакет: все виды ретуши', 'retouch', 'auto_fix_high', 1990.00, 20.00, 3, 'monthly', true, 20, true, true, '["10 простых", "3 базовых", "5 репортажных", "1 профессиональная", "Скидка 20% сверх лимита"]'::jsonb),
  ('retouch-studio', 'Студия', 'Студийный пакет: максимальный объём ретуши', 'retouch', 'auto_fix_high', 4990.00, 30.00, 3, 'monthly', true, 30, false, true, '["30 простых", "5 базовых", "10 репортажных", "1 профессиональная", "Скидка 30% сверх лимита"]'::jsonb)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  icon = EXCLUDED.icon,
  base_price = EXCLUDED.base_price,
  subscriber_discount_percent = EXCLUDED.subscriber_discount_percent,
  credits_rollover_months = EXCLUDED.credits_rollover_months,
  billing_period = EXCLUDED.billing_period,
  is_active = true,
  sort_order = EXCLUDED.sort_order,
  is_popular = EXCLUDED.is_popular,
  is_customizable = EXCLUDED.is_customizable,
  features = EXCLUDED.features,
  updated_at = NOW();

-- =====================================================
-- STEP 4: Delete old plan_items for new plans, then insert fresh
-- =====================================================

-- Remove existing items for all new plans (idempotent: if plans just created, no items exist yet)
DELETE FROM subscription_plan_items
WHERE plan_id IN (SELECT id FROM subscription_plans WHERE slug IN (
  'doc-print-student', 'doc-print-business', 'doc-print-office',
  'photo-print-fan', 'photo-print-family', 'photo-print-pro',
  'scan-lite', 'scan-pro', 'scan-biz',
  'photo-docs-agent', 'photo-docs-agency', 'photo-docs-corp',
  'retouch-fan', 'retouch-pro', 'retouch-studio'
));

-- === doc-print-student: 100 A4 ч/б, 10 A4 цвет ===
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, is_required, sort_order)
VALUES
  ((SELECT id FROM subscription_plans WHERE slug = 'doc-print-student'),
   '71b5eabc-f00a-434a-a0fe-9db001a79bbb', 100, true, 10),  -- A4 ч/б
  ((SELECT id FROM subscription_plans WHERE slug = 'doc-print-student'),
   '4c2f07f5-6e29-43f6-ae5e-6712379ecd83', 10, true, 20);   -- A4 цвет (матовая 120g)

-- === doc-print-business: 300 A4 ч/б, 30 A4 цвет, 10 A3 ===
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, is_required, sort_order)
VALUES
  ((SELECT id FROM subscription_plans WHERE slug = 'doc-print-business'),
   '71b5eabc-f00a-434a-a0fe-9db001a79bbb', 300, true, 10),  -- A4 ч/б
  ((SELECT id FROM subscription_plans WHERE slug = 'doc-print-business'),
   '4c2f07f5-6e29-43f6-ae5e-6712379ecd83', 30, true, 20),   -- A4 цвет
  ((SELECT id FROM subscription_plans WHERE slug = 'doc-print-business'),
   '95801867-e56d-4d4c-96c4-08ee9b14d3aa', 10, true, 30);   -- A3

-- === doc-print-office: 800 A4 ч/б, 80 A4 цвет, 30 A3, 10 глянец ===
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, is_required, sort_order)
VALUES
  ((SELECT id FROM subscription_plans WHERE slug = 'doc-print-office'),
   '71b5eabc-f00a-434a-a0fe-9db001a79bbb', 800, true, 10),  -- A4 ч/б
  ((SELECT id FROM subscription_plans WHERE slug = 'doc-print-office'),
   '4c2f07f5-6e29-43f6-ae5e-6712379ecd83', 80, true, 20),   -- A4 цвет
  ((SELECT id FROM subscription_plans WHERE slug = 'doc-print-office'),
   '95801867-e56d-4d4c-96c4-08ee9b14d3aa', 30, true, 30),   -- A3
  ((SELECT id FROM subscription_plans WHERE slug = 'doc-print-office'),
   'bebafbfe-3900-45f1-9ec4-2a2da2860a81', 10, true, 40);   -- глянец

-- === photo-print-fan: 20 10x15, 3 15x21 ===
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, is_required, sort_order)
VALUES
  ((SELECT id FROM subscription_plans WHERE slug = 'photo-print-fan'),
   '81476759-8e40-4d50-a15b-556f3f8a3368', 20, true, 10),  -- 10x15
  ((SELECT id FROM subscription_plans WHERE slug = 'photo-print-fan'),
   '66848433-f5e8-4aaa-ae00-fe0705ad2f31', 3, true, 20);   -- 15x21

-- === photo-print-family: 40 10x15, 8 15x21, 2 21x30 ===
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, is_required, sort_order)
VALUES
  ((SELECT id FROM subscription_plans WHERE slug = 'photo-print-family'),
   '81476759-8e40-4d50-a15b-556f3f8a3368', 40, true, 10),  -- 10x15
  ((SELECT id FROM subscription_plans WHERE slug = 'photo-print-family'),
   '66848433-f5e8-4aaa-ae00-fe0705ad2f31', 8, true, 20),   -- 15x21
  ((SELECT id FROM subscription_plans WHERE slug = 'photo-print-family'),
   '9d710edb-0cfd-4419-8aed-f6b59986bc1b', 2, true, 30);   -- 21x30

-- === photo-print-pro: 80 10x15, 15 15x21, 5 21x30, 2 30x40 ===
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, is_required, sort_order)
VALUES
  ((SELECT id FROM subscription_plans WHERE slug = 'photo-print-pro'),
   '81476759-8e40-4d50-a15b-556f3f8a3368', 80, true, 10),  -- 10x15
  ((SELECT id FROM subscription_plans WHERE slug = 'photo-print-pro'),
   '66848433-f5e8-4aaa-ae00-fe0705ad2f31', 15, true, 20),  -- 15x21
  ((SELECT id FROM subscription_plans WHERE slug = 'photo-print-pro'),
   '9d710edb-0cfd-4419-8aed-f6b59986bc1b', 5, true, 30),   -- 21x30
  ((SELECT id FROM subscription_plans WHERE slug = 'photo-print-pro'),
   '80b3d641-d2ce-475a-a74c-8003f05f1eca', 2, true, 40);   -- 30x40

-- === scan-lite: 100 авто, 5 ручных ===
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, is_required, sort_order)
VALUES
  ((SELECT id FROM subscription_plans WHERE slug = 'scan-lite'),
   'a1000001-0000-0000-0000-000000000001', 100, true, 10),  -- авто-скан
  ((SELECT id FROM subscription_plans WHERE slug = 'scan-lite'),
   'a1000001-0000-0000-0000-000000000002', 5, true, 20);    -- ручное

-- === scan-pro: 300 авто, 20 ручных, 10 кадрирований ===
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, is_required, sort_order)
VALUES
  ((SELECT id FROM subscription_plans WHERE slug = 'scan-pro'),
   'a1000001-0000-0000-0000-000000000001', 300, true, 10),  -- авто-скан
  ((SELECT id FROM subscription_plans WHERE slug = 'scan-pro'),
   'a1000001-0000-0000-0000-000000000002', 20, true, 20),   -- ручное
  ((SELECT id FROM subscription_plans WHERE slug = 'scan-pro'),
   'a1000001-0000-0000-0000-000000000003', 10, true, 30);   -- кадрирование

-- === scan-biz: 500 авто, 30 ручных, 20 кадрирований, 10 ламинирований ===
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, is_required, sort_order)
VALUES
  ((SELECT id FROM subscription_plans WHERE slug = 'scan-biz'),
   'a1000001-0000-0000-0000-000000000001', 500, true, 10),  -- авто-скан
  ((SELECT id FROM subscription_plans WHERE slug = 'scan-biz'),
   'a1000001-0000-0000-0000-000000000002', 30, true, 20),   -- ручное
  ((SELECT id FROM subscription_plans WHERE slug = 'scan-biz'),
   'a1000001-0000-0000-0000-000000000003', 20, true, 30),   -- кадрирование
  ((SELECT id FROM subscription_plans WHERE slug = 'scan-biz'),
   '25ad33fd-04cd-4aa4-88f5-051341f50632', 10, true, 40);   -- ламинирование

-- === photo-docs-agent: 5 комплектов, 2 подстановки, 1 нейро-стандарт ===
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, is_required, sort_order)
VALUES
  ((SELECT id FROM subscription_plans WHERE slug = 'photo-docs-agent'),
   '4f15d878-7551-4d89-8a6b-89f50db1e754', 5, true, 10),   -- комплекты
  ((SELECT id FROM subscription_plans WHERE slug = 'photo-docs-agent'),
   '139e3e29-cdc1-4fbb-9bb6-4330774baa03', 2, true, 20),   -- подстановка формы
  ((SELECT id FROM subscription_plans WHERE slug = 'photo-docs-agent'),
   'b0eb8f69-22bc-4cdd-a15f-f4f9848dbc4a', 1, true, 30);   -- нейро-стандарт

-- === photo-docs-agency: 12 комплектов, 6 подстановок, 3 нейро-стандарт, 1 нейро-полный ===
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, is_required, sort_order)
VALUES
  ((SELECT id FROM subscription_plans WHERE slug = 'photo-docs-agency'),
   '4f15d878-7551-4d89-8a6b-89f50db1e754', 12, true, 10),  -- комплекты
  ((SELECT id FROM subscription_plans WHERE slug = 'photo-docs-agency'),
   '139e3e29-cdc1-4fbb-9bb6-4330774baa03', 6, true, 20),   -- подстановка формы
  ((SELECT id FROM subscription_plans WHERE slug = 'photo-docs-agency'),
   'b0eb8f69-22bc-4cdd-a15f-f4f9848dbc4a', 3, true, 30),   -- нейро-стандарт
  ((SELECT id FROM subscription_plans WHERE slug = 'photo-docs-agency'),
   '8479ccc3-d5e0-4d83-aeaf-6204f7f2b088', 1, true, 40);   -- нейро-полный

-- === photo-docs-corp: 25 комплектов, 15 подстановок, 5 нейро-стандарт, 2 нейро-полных, 2 срочных ===
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, is_required, sort_order)
VALUES
  ((SELECT id FROM subscription_plans WHERE slug = 'photo-docs-corp'),
   '4f15d878-7551-4d89-8a6b-89f50db1e754', 25, true, 10),  -- комплекты
  ((SELECT id FROM subscription_plans WHERE slug = 'photo-docs-corp'),
   '139e3e29-cdc1-4fbb-9bb6-4330774baa03', 15, true, 20),  -- подстановка формы
  ((SELECT id FROM subscription_plans WHERE slug = 'photo-docs-corp'),
   'b0eb8f69-22bc-4cdd-a15f-f4f9848dbc4a', 5, true, 30),   -- нейро-стандарт
  ((SELECT id FROM subscription_plans WHERE slug = 'photo-docs-corp'),
   '8479ccc3-d5e0-4d83-aeaf-6204f7f2b088', 2, true, 40),   -- нейро-полный
  ((SELECT id FROM subscription_plans WHERE slug = 'photo-docs-corp'),
   '359a4565-83b7-4120-bc06-2f4ea5a6efaf', 2, true, 50);   -- срочная

-- === retouch-fan: 5 простых, 1 базовая ===
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, is_required, sort_order)
VALUES
  ((SELECT id FROM subscription_plans WHERE slug = 'retouch-fan'),
   'a1000002-0000-0000-0000-000000000001', 5, true, 10),    -- простая
  ((SELECT id FROM subscription_plans WHERE slug = 'retouch-fan'),
   'a1000002-0000-0000-0000-000000000002', 1, true, 20);    -- базовая

-- === retouch-pro: 10 простых, 3 базовых, 5 репортажных, 1 профессиональная ===
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, is_required, sort_order)
VALUES
  ((SELECT id FROM subscription_plans WHERE slug = 'retouch-pro'),
   'a1000002-0000-0000-0000-000000000001', 10, true, 10),   -- простая
  ((SELECT id FROM subscription_plans WHERE slug = 'retouch-pro'),
   'a1000002-0000-0000-0000-000000000002', 3, true, 20),    -- базовая
  ((SELECT id FROM subscription_plans WHERE slug = 'retouch-pro'),
   'a1000002-0000-0000-0000-000000000003', 5, true, 30),    -- репортажная
  ((SELECT id FROM subscription_plans WHERE slug = 'retouch-pro'),
   'a1000002-0000-0000-0000-000000000004', 1, true, 40);    -- профессиональная

-- === retouch-studio: 30 простых, 5 базовых, 10 репортажных, 1 профессиональная ===
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, is_required, sort_order)
VALUES
  ((SELECT id FROM subscription_plans WHERE slug = 'retouch-studio'),
   'a1000002-0000-0000-0000-000000000001', 30, true, 10),   -- простая
  ((SELECT id FROM subscription_plans WHERE slug = 'retouch-studio'),
   'a1000002-0000-0000-0000-000000000002', 5, true, 20),    -- базовая
  ((SELECT id FROM subscription_plans WHERE slug = 'retouch-studio'),
   'a1000002-0000-0000-0000-000000000003', 10, true, 30),   -- репортажная
  ((SELECT id FROM subscription_plans WHERE slug = 'retouch-studio'),
   'a1000002-0000-0000-0000-000000000004', 1, true, 40);    -- профессиональная

COMMIT;
