-- Pricing Strategy v1: price_next_unit, beard-removal fix, hero bundles, subscriptions, volume modifiers
-- Applied: 2026-03-23
-- Idempotent: all statements use ON CONFLICT or conditional WHERE

BEGIN;

-- ============================================================
-- 1. price_next_unit for retouch services
-- ============================================================
UPDATE service_options SET price_next_unit = 80,  updated_at = now() WHERE slug = 'portfolio-retouch';
UPDATE service_options SET price_next_unit = 160, updated_at = now() WHERE slug = 'retouch-reportage';
UPDATE service_options SET price_next_unit = 500, updated_at = now() WHERE slug = 'studio-retouch-basic';
UPDATE service_options SET price_next_unit = 750, updated_at = now() WHERE slug = 'studio-retouch-pro';
UPDATE service_options SET price_next_unit = 1200, updated_at = now() WHERE slug = 'studio-retouch-premium';

-- ============================================================
-- 2. price_next_unit for restoration services
-- ============================================================
UPDATE service_options SET price_next_unit = 800,  updated_at = now() WHERE slug = 'km-реставрация-фото-простая';
UPDATE service_options SET price_next_unit = 1400, updated_at = now() WHERE slug = 'km-реставрация-фото-средняя';
UPDATE service_options SET price_next_unit = 1800, updated_at = now() WHERE slug = 'km-реставрация-фото-под-гравировку';
UPDATE service_options SET price_next_unit = 2500, updated_at = now() WHERE slug = 'km-реставрация-фото-сложная';
UPDATE service_options SET price_next_unit = 3600, updated_at = now() WHERE slug = 'km-реставрация-фото-профи';

-- ============================================================
-- 3. price_next_unit for text services
-- ============================================================
UPDATE service_options SET price_next_unit = 40,  updated_at = now() WHERE slug = 'text-layout';
UPDATE service_options SET price_next_unit = 170, updated_at = now() WHERE slug = 'text-edit';
UPDATE service_options SET price_next_unit = 250, updated_at = now() WHERE slug = 'text-set';

-- ============================================================
-- 4. Fix beard-removal original_price (390 -> 590)
-- ============================================================
UPDATE service_options SET original_price = 590, updated_at = now()
WHERE slug = 'beard-removal' AND original_price = 390;

-- ============================================================
-- 5. Hero bundles (Paradny Geroy) in voennaya-retush category
-- ============================================================

-- Create option group
INSERT INTO option_groups (service_category_id, slug, name, selection_type, sort_order)
VALUES (
  (SELECT id FROM service_categories WHERE slug = 'voennaya-retush'),
  'hero-bundles', 'Готовые комплекты', 'single', 5
)
ON CONFLICT (service_category_id, slug) DO UPDATE SET
  name = EXCLUDED.name,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

-- Insert 3 hero bundle options
INSERT INTO service_options (option_group_id, slug, name, base_price, price_studio, original_price, discount_percent, features, sort_order, is_active)
VALUES
  (
    (SELECT id FROM option_groups WHERE slug = 'hero-bundles' AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'voennaya-retush')),
    'hero-basic', 'Базовый Герой', 880, 880, 980, 10,
    '["Простая обработка", "Подстановка формы"]'::jsonb, 1, true
  ),
  (
    (SELECT id FROM option_groups WHERE slug = 'hero-bundles' AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'voennaya-retush')),
    'hero-full', 'Полный Герой', 1470, 1470, 1670, 12,
    '["Художественная обработка", "Подстановка формы", "Медали и погоны"]'::jsonb, 2, true
  ),
  (
    (SELECT id FROM option_groups WHERE slug = 'hero-bundles' AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'voennaya-retush')),
    'hero-premium', 'Премиум Герой', 2190, 2190, 2750, 20,
    '["Восстановление + обработка", "Подстановка формы", "Медали и погоны", "Шевроны и нашивки", "Подарочное оформление"]'::jsonb, 3, true
  )
ON CONFLICT (option_group_id, slug) DO UPDATE SET
  name = EXCLUDED.name,
  base_price = EXCLUDED.base_price,
  price_studio = EXCLUDED.price_studio,
  original_price = EXCLUDED.original_price,
  discount_percent = EXCLUDED.discount_percent,
  features = EXCLUDED.features,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

-- ============================================================
-- 6. Subscription plans (9 plans: 3 categories x 3 tiers)
-- ============================================================

-- Print plans
INSERT INTO subscription_plans (slug, name, base_price, billing_period, subscriber_discount_percent, category, sort_order, is_customizable, credits_rollover_months, is_active, is_popular, features)
VALUES
  ('print-student', 'Студент', 199, 'monthly', 15, 'print', 10, false, 3, true, false,
   '["Скидка 15% на все виды печати", "До 200 страниц/мес", "Черно-белая и цветная печать"]'::jsonb),
  ('print-business', 'Бизнес', 899, 'monthly', 20, 'print', 11, false, 3, true, false,
   '["Скидка 20% на все виды печати", "До 1000 страниц/мес", "Приоритетное обслуживание", "Цветная и ч/б печать"]'::jsonb),
  ('print-office', 'Офис', 2490, 'monthly', 30, 'print', 12, false, 3, true, false,
   '["Скидка 30% на все виды печати", "Безлимитная печать", "Приоритетное обслуживание", "Бесплатная доставка в офис"]'::jsonb)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  base_price = EXCLUDED.base_price,
  subscriber_discount_percent = EXCLUDED.subscriber_discount_percent,
  category = EXCLUDED.category,
  sort_order = EXCLUDED.sort_order,
  is_customizable = EXCLUDED.is_customizable,
  credits_rollover_months = EXCLUDED.credits_rollover_months,
  features = EXCLUDED.features,
  is_popular = EXCLUDED.is_popular,
  updated_at = now();

-- Photo-print plans
INSERT INTO subscription_plans (slug, name, base_price, billing_period, subscriber_discount_percent, category, sort_order, is_customizable, credits_rollover_months, is_active, is_popular, features)
VALUES
  ('photoprint-fan', 'Любитель', 249, 'monthly', 10, 'photo-print', 20, false, 3, true, false,
   '["Скидка 10% на фотопечать", "До 50 фото/мес", "Все форматы до 15x20"]'::jsonb),
  ('photoprint-family', 'Семейный', 599, 'monthly', 15, 'photo-print', 21, false, 3, true, true,
   '["Скидка 15% на фотопечать", "До 200 фото/мес", "Все форматы", "Бесплатное кадрирование"]'::jsonb),
  ('photoprint-photographer', 'Фотограф', 1290, 'monthly', 20, 'photo-print', 22, false, 3, true, false,
   '["Скидка 20% на фотопечать", "Безлимитная печать", "Профессиональная бумага", "Приоритетная очередь"]'::jsonb)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  base_price = EXCLUDED.base_price,
  subscriber_discount_percent = EXCLUDED.subscriber_discount_percent,
  category = EXCLUDED.category,
  sort_order = EXCLUDED.sort_order,
  is_customizable = EXCLUDED.is_customizable,
  credits_rollover_months = EXCLUDED.credits_rollover_months,
  features = EXCLUDED.features,
  is_popular = EXCLUDED.is_popular,
  updated_at = now();

-- Document plans
INSERT INTO subscription_plans (slug, name, base_price, billing_period, subscriber_discount_percent, category, sort_order, is_customizable, credits_rollover_months, is_active, is_popular, features)
VALUES
  ('docs-agent', 'Агент', 1990, 'monthly', 10, 'photo-docs', 30, false, 3, true, false,
   '["Скидка 10% на фото на документы", "До 50 комплектов/мес", "Все типы документов"]'::jsonb),
  ('docs-agency', 'Агентство', 5990, 'monthly', 15, 'photo-docs', 31, false, 3, true, true,
   '["Скидка 15% на фото на документы", "До 200 комплектов/мес", "Приоритетная обработка", "Выделенный менеджер"]'::jsonb),
  ('docs-corporate', 'Корпорат', 12900, 'monthly', 25, 'photo-docs', 32, false, 3, true, false,
   '["Скидка 25% на фото на документы", "Безлимитные комплекты", "Приоритетная обработка", "Выделенный менеджер", "Выезд фотографа"]'::jsonb)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  base_price = EXCLUDED.base_price,
  subscriber_discount_percent = EXCLUDED.subscriber_discount_percent,
  category = EXCLUDED.category,
  sort_order = EXCLUDED.sort_order,
  is_customizable = EXCLUDED.is_customizable,
  credits_rollover_months = EXCLUDED.credits_rollover_months,
  features = EXCLUDED.features,
  is_popular = EXCLUDED.is_popular,
  updated_at = now();

-- ============================================================
-- 7. Volume price modifiers for A4 print services
-- ============================================================

-- A4 ч/б ксерокопия (base 10р)
INSERT INTO price_modifiers (name, modifier_type, scope, service_option_id, modifier_action, modifier_value, conditions, priority, is_active)
VALUES
  ('A4 ч/б 50-99шт', 'volume', 'option',
   (SELECT id FROM service_options WHERE slug = 'km-а4-ксерокопия' LIMIT 1),
   'multiply', 0.8000, '{"min_qty": 50, "max_qty": 99}'::jsonb, 10, true),
  ('A4 ч/б 100-299шт', 'volume', 'option',
   (SELECT id FROM service_options WHERE slug = 'km-а4-ксерокопия' LIMIT 1),
   'multiply', 0.7000, '{"min_qty": 100, "max_qty": 299}'::jsonb, 20, true),
  ('A4 ч/б 300+шт', 'volume', 'option',
   (SELECT id FROM service_options WHERE slug = 'km-а4-ксерокопия' LIMIT 1),
   'multiply', 0.5000, '{"min_qty": 300}'::jsonb, 30, true)
ON CONFLICT DO NOTHING;

-- A4 цветная ксерокопия (base 15р)
INSERT INTO price_modifiers (name, modifier_type, scope, service_option_id, modifier_action, modifier_value, conditions, priority, is_active)
VALUES
  ('A4 цвет 50-99шт', 'volume', 'option',
   (SELECT id FROM service_options WHERE slug = 'km-а4-ксерокопия-цветная' LIMIT 1),
   'multiply', 0.8000, '{"min_qty": 50, "max_qty": 99}'::jsonb, 10, true),
  ('A4 цвет 100-299шт', 'volume', 'option',
   (SELECT id FROM service_options WHERE slug = 'km-а4-ксерокопия-цветная' LIMIT 1),
   'multiply', 0.7000, '{"min_qty": 100, "max_qty": 299}'::jsonb, 20, true),
  ('A4 цвет 300+шт', 'volume', 'option',
   (SELECT id FROM service_options WHERE slug = 'km-а4-ксерокопия-цветная' LIMIT 1),
   'multiply', 0.5000, '{"min_qty": 300}'::jsonb, 30, true)
ON CONFLICT DO NOTHING;

-- A4 фото цветная (base 30р)
INSERT INTO price_modifiers (name, modifier_type, scope, service_option_id, modifier_action, modifier_value, conditions, priority, is_active)
VALUES
  ('A4 фото-цвет 50-99шт', 'volume', 'option',
   (SELECT id FROM service_options WHERE slug = 'km-а4-ксерокопия-фото-цветная' LIMIT 1),
   'multiply', 0.8000, '{"min_qty": 50, "max_qty": 99}'::jsonb, 10, true),
  ('A4 фото-цвет 100-299шт', 'volume', 'option',
   (SELECT id FROM service_options WHERE slug = 'km-а4-ксерокопия-фото-цветная' LIMIT 1),
   'multiply', 0.7000, '{"min_qty": 100, "max_qty": 299}'::jsonb, 20, true),
  ('A4 фото-цвет 300+шт', 'volume', 'option',
   (SELECT id FROM service_options WHERE slug = 'km-а4-ксерокопия-фото-цветная' LIMIT 1),
   'multiply', 0.5000, '{"min_qty": 300}'::jsonb, 30, true)
ON CONFLICT DO NOTHING;

-- A4 печать документа (base 10р)
INSERT INTO price_modifiers (name, modifier_type, scope, service_option_id, modifier_action, modifier_value, conditions, priority, is_active)
VALUES
  ('A4 печать 50-99шт', 'volume', 'option',
   (SELECT id FROM service_options WHERE slug = 'km-а4-печать-документа' LIMIT 1),
   'multiply', 0.8000, '{"min_qty": 50, "max_qty": 99}'::jsonb, 10, true),
  ('A4 печать 100-299шт', 'volume', 'option',
   (SELECT id FROM service_options WHERE slug = 'km-а4-печать-документа' LIMIT 1),
   'multiply', 0.7000, '{"min_qty": 100, "max_qty": 299}'::jsonb, 20, true),
  ('A4 печать 300+шт', 'volume', 'option',
   (SELECT id FROM service_options WHERE slug = 'km-а4-печать-документа' LIMIT 1),
   'multiply', 0.5000, '{"min_qty": 300}'::jsonb, 30, true)
ON CONFLICT DO NOTHING;

-- A4 печать документа цветная (base 15р)
INSERT INTO price_modifiers (name, modifier_type, scope, service_option_id, modifier_action, modifier_value, conditions, priority, is_active)
VALUES
  ('A4 печать цвет 50-99шт', 'volume', 'option',
   (SELECT id FROM service_options WHERE slug = 'km-а4-печать-документа-цветная' LIMIT 1),
   'multiply', 0.8000, '{"min_qty": 50, "max_qty": 99}'::jsonb, 10, true),
  ('A4 печать цвет 100-299шт', 'volume', 'option',
   (SELECT id FROM service_options WHERE slug = 'km-а4-печать-документа-цветная' LIMIT 1),
   'multiply', 0.7000, '{"min_qty": 100, "max_qty": 299}'::jsonb, 20, true),
  ('A4 печать цвет 300+шт', 'volume', 'option',
   (SELECT id FROM service_options WHERE slug = 'km-а4-печать-документа-цветная' LIMIT 1),
   'multiply', 0.5000, '{"min_qty": 300}'::jsonb, 30, true)
ON CONFLICT DO NOTHING;

COMMIT;
