-- =============================================================================
-- Phase 6: Subscriptions + Loyalty + Kontur Migration
-- =============================================================================

-- 6.2 Loyalty: customer_id link (soft reference — customers owned by postgres)
-- =============================================================================
ALTER TABLE loyalty_profiles
  ADD COLUMN IF NOT EXISTS customer_id UUID;

CREATE INDEX IF NOT EXISTS idx_loyalty_profiles_customer_id
  ON loyalty_profiles(customer_id) WHERE customer_id IS NOT NULL;

-- Автоматически слинковать существующие профили через telegram_user_id:
-- customers.telegram_user_id (bigint TG ID) → telegram_users.telegram_id → telegram_users.id = loyalty_profiles.telegram_user_id
UPDATE loyalty_profiles lp
SET customer_id = c.id, updated_at = NOW()
FROM customers c
JOIN telegram_users tu ON tu.telegram_id = c.telegram_user_id
WHERE lp.telegram_user_id = tu.id
  AND lp.customer_id IS NULL
  AND c.telegram_user_id IS NOT NULL;

-- =============================================================================
-- 6.4 Studio Services: Фото-печать
-- =============================================================================

INSERT INTO service_categories
  (slug, name, description, icon, gradient, price_range, valid_delivery_methods, display_channels, sort_order, is_active)
VALUES
  ('photo-print', 'Фото-печать', 'Печать фотографий всех форматов — премиум и матовая бумага', '🖨️',
   'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
   'от 19₽', '{pickup,postal}', '{website,chatbot,pos}', 10, true)
ON CONFLICT (slug) DO NOTHING;

-- Группа опций: формат фото
INSERT INTO option_groups
  (service_category_id, slug, name, description, selection_type, is_required, min_selections, max_selections, sort_order, is_active)
SELECT
  sc.id, 'photo-format', 'Формат фото', 'Выберите формат отпечатка',
  'single', true, 1, 1, 1, true
FROM service_categories sc
WHERE sc.slug = 'photo-print'
ON CONFLICT (service_category_id, slug) DO NOTHING;

-- Опции формата (цены из Kontur)
INSERT INTO service_options
  (option_group_id, slug, name, description, base_price, price_studio, sort_order)
SELECT
  og.id, opt.slug, opt.nm, opt.dsc, opt.price, opt.price, opt.srt
FROM option_groups og
JOIN service_categories sc ON og.service_category_id = sc.id
CROSS JOIN (VALUES
  ('10x15-premium', 'Фото 10×15 премиум (матт)', 'Матовая фотобумага, 10×15 см', 19,  1),
  ('10x15-super',   'Фото 10×15 супер (глянец)', 'Глянцевая фотобумага, 10×15 см', 36, 2),
  ('15x20-premium', 'Фото 15×20 премиум (матт)', 'Матовая фотобумага, 15×20 см', 49,  3),
  ('15x20-super',   'Фото 15×20 супер (глянец)', 'Глянцевая фотобумага, 15×20 см', 70, 4),
  ('20x30-premium', 'Фото 20×30 премиум (матт)', 'Матовая фотобумага, 20×30 см', 117, 5),
  ('20x30-super',   'Фото 20×30 супер (глянец)', 'Глянцевая фотобумага, 20×30 см', 140, 6),
  ('30x40',         'Фото 30×40',                'Крупный формат 30×40 см', 450,      7),
  ('40x50',         'Фото 40×50',                'Крупный формат 40×50 см', 600,      8)
) AS opt(slug, nm, dsc, price, srt)
WHERE sc.slug = 'photo-print' AND og.slug = 'photo-format'
ON CONFLICT (option_group_id, slug) DO NOTHING;

-- Группа опций: дополнительно
INSERT INTO option_groups
  (service_category_id, slug, name, description, selection_type, is_required, min_selections, max_selections, sort_order, is_active)
SELECT
  sc.id, 'photo-extras', 'Дополнительно', 'Дополнительные услуги к печати',
  'multi', false, 0, 3, 2, true
FROM service_categories sc
WHERE sc.slug = 'photo-print'
ON CONFLICT (service_category_id, slug) DO NOTHING;

INSERT INTO service_options
  (option_group_id, slug, name, description, base_price, price_studio, sort_order)
SELECT
  og.id, opt.slug, opt.nm, opt.dsc, opt.price, opt.price, opt.srt
FROM option_groups og
JOIN service_categories sc ON og.service_category_id = sc.id
CROSS JOIN (VALUES
  ('lamination',  'Ламинирование',  'Ламинирование распечатанного фото', 100, 1),
  ('frame-a6',    'Рамка А6',       'Фоторамка формата А6', 400,                2),
  ('frame-a5',    'Рамка А5',       'Фоторамка формата А5', 450,                3),
  ('frame-a4',    'Рамка А4',       'Фоторамка формата А4', 500,                4),
  ('frame-a3',    'Рамка А3',       'Фоторамка формата А3', 800,                5)
) AS opt(slug, nm, dsc, price, srt)
WHERE sc.slug = 'photo-print' AND og.slug = 'photo-extras'
ON CONFLICT (option_group_id, slug) DO NOTHING;

-- =============================================================================
-- 6.4 Studio Services: Ксерокопирование и сканирование
-- =============================================================================

INSERT INTO service_categories
  (slug, name, description, icon, gradient, price_range, valid_delivery_methods, display_channels, sort_order, is_active)
VALUES
  ('scan-copy', 'Ксерокопирование и сканирование', 'Копирование и сканирование документов А4/А3', '📄',
   'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
   'от 5₽', '{pickup}', '{website,chatbot,pos}', 20, true)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO option_groups
  (service_category_id, slug, name, description, selection_type, is_required, min_selections, max_selections, sort_order, is_active)
SELECT
  sc.id, 'scan-copy-type', 'Тип услуги', 'Выберите услугу',
  'single', true, 1, 1, 1, true
FROM service_categories sc
WHERE sc.slug = 'scan-copy'
ON CONFLICT (service_category_id, slug) DO NOTHING;

INSERT INTO service_options
  (option_group_id, slug, name, description, base_price, price_studio, sort_order)
SELECT
  og.id, opt.slug, opt.nm, opt.dsc, opt.price, opt.price, opt.srt
FROM option_groups og
JOIN service_categories sc ON og.service_category_id = sc.id
CROSS JOIN (VALUES
  ('copy-a4-bw',    'Ксерокопия А4 ч/б',      'Чёрно-белое копирование А4', 10,    1),
  ('copy-a4-color', 'Ксерокопия А4 цветная',   'Цветное копирование А4', 15,        2),
  ('copy-a3-bw',    'Ксерокопия А3 ч/б',      'Чёрно-белое копирование А3', 17,    3),
  ('copy-a3-color', 'Ксерокопия А3 цветная',   'Цветное копирование А3', 30,        4),
  ('scan-manual',   'Сканирование',             'Ручное сканирование документов', 50, 5),
  ('scan-auto',     'Сканирование авто',        'Автоматическая подача', 5,          6),
  ('print-a4-bw',   'Печать А4 ч/б',           'Чёрно-белая печать А4', 10,        7),
  ('print-a4-color','Печать А4 цветная',        'Цветная печать А4', 15,            8),
  ('print-a3-bw',   'Печать А3 ч/б',           'Чёрно-белая печать А3', 17,        9),
  ('print-a3-color','Печать А3 цветная',        'Цветная печать А3', 17,            10)
) AS opt(slug, nm, dsc, price, srt)
WHERE sc.slug = 'scan-copy' AND og.slug = 'scan-copy-type'
ON CONFLICT (option_group_id, slug) DO NOTHING;

-- =============================================================================
-- 6.4 Studio Services: Полиграфия и сувениры
-- =============================================================================

INSERT INTO service_categories
  (slug, name, description, icon, gradient, price_range, valid_delivery_methods, display_channels, sort_order, is_active)
VALUES
  ('souvenirs', 'Полиграфия и сувениры', 'Печать на кружках, футболках, визитки, холсты', '🎁',
   'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
   'от 100₽', '{pickup,postal}', '{website,chatbot,pos}', 30, true)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO option_groups
  (service_category_id, slug, name, description, selection_type, is_required, min_selections, max_selections, sort_order, is_active)
SELECT
  sc.id, 'souvenir-type', 'Тип изделия', 'Выберите изделие',
  'single', true, 1, 1, 1, true
FROM service_categories sc
WHERE sc.slug = 'souvenirs'
ON CONFLICT (service_category_id, slug) DO NOTHING;

INSERT INTO service_options
  (option_group_id, slug, name, description, base_price, price_studio, sort_order)
SELECT
  og.id, opt.slug, opt.nm, opt.dsc, opt.price, opt.price, opt.srt
FROM option_groups og
JOIN service_categories sc ON og.service_category_id = sc.id
CROSS JOIN (VALUES
  ('mug-print',        'Печать на кружке',        'Фото/принт на керамической кружке', 390, 1),
  ('tshirt-print',     'Печать на футболке',       'Фото/принт на хлопковой футболке', 590,  2),
  ('canvas-30x40',     'Холст 30×40',              'Фото на холсте 30×40 см', 2200,           3),
  ('canvas-50x70',     'Холст 50×70',              'Фото на холсте 50×70 см', 3400,           4),
  ('canvas-70x100',    'Холст 70×100',             'Фото на холсте 70×100 см', 4300,          5),
  ('cards-paper-100',  'Визитки бумага 100 шт',    'Визитки на матовой бумаге, 100 шт', 600,  6),
  ('cards-plastic-50', 'Визитки пластик 50 шт',    'Пластиковые визитки, 50 шт', 1000,        7),
  ('polaroid',         'Полароид',                 'Мгновенная полароид-фотография', 100,      8)
) AS opt(slug, nm, dsc, price, srt)
WHERE sc.slug = 'souvenirs' AND og.slug = 'souvenir-type'
ON CONFLICT (option_group_id, slug) DO NOTHING;

-- =============================================================================
-- 6.4 Дизайн-услуги
-- =============================================================================

INSERT INTO service_categories
  (slug, name, description, icon, gradient, price_range, valid_delivery_methods, display_channels, sort_order, is_active)
VALUES
  ('design', 'Дизайн', 'Разработка макетов: визитки, листовки, буклеты, меню', '🎨',
   'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
   'от 50₽', '{electronic,pickup}', '{website,chatbot,pos}', 40, true)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO option_groups
  (service_category_id, slug, name, description, selection_type, is_required, min_selections, max_selections, sort_order, is_active)
SELECT
  sc.id, 'design-type', 'Тип дизайна', 'Выберите вид работы',
  'single', true, 1, 1, 1, true
FROM service_categories sc
WHERE sc.slug = 'design'
ON CONFLICT (service_category_id, slug) DO NOTHING;

INSERT INTO service_options
  (option_group_id, slug, name, description, base_price, price_online, price_studio, sort_order)
SELECT
  og.id, opt.slug, opt.nm, opt.dsc, opt.price, opt.price_online, opt.price_studio, opt.srt
FROM option_groups og
JOIN service_categories sc ON og.service_category_id = sc.id
CROSS JOIN (VALUES
  ('design-card',      'Дизайн визитки',          'Разработка макета визитки', 500,  500,  500,  1),
  ('design-flyer',     'Дизайн листовки/флайера',  'Дизайн листовки А5/А6', 1000,  1000, 1000, 2),
  ('design-booklet',   'Дизайн буклета',           'Разработка буклета', 2000,     2000, 2000,  3),
  ('design-menu',      'Дизайн меню для кафе',     'Разработка меню', 2500,        2500, 2500,  4),
  ('design-pricelist', 'Дизайн прайс-листа',       'Дизайн прайс-листа', 1000,    1000, 1000,  5),
  ('text-set',         'Набор текста',             'Набор и форматирование текста', 300, 300, 300, 6),
  ('text-edit',        'Редактирование текста',    'Вычитка и правка текста', 200,  200,  200,  7),
  ('text-layout',      'Размещение текста',        'Вёрстка текста в документ', 50, 50,   50,   8)
) AS opt(slug, nm, dsc, price, price_online, price_studio, srt)
WHERE sc.slug = 'design' AND og.slug = 'design-type'
ON CONFLICT (option_group_id, slug) DO NOTHING;

-- =============================================================================
-- Аудит создания студийных категорий
-- =============================================================================
INSERT INTO pricing_snapshots
  (entity_type, entity_id, changed_by, old_values, new_values, reason)
SELECT
  'service_category', sc.id, NULL,
  '{}'::jsonb,
  jsonb_build_object('slug', sc.slug, 'name', sc.name, 'valid_delivery_methods', sc.valid_delivery_methods),
  'Phase 6: Миграция студийных сервисов из Kontur в pricing DB'
FROM service_categories sc
WHERE sc.slug IN ('photo-print', 'scan-copy', 'souvenirs', 'design')
ON CONFLICT DO NOTHING;
