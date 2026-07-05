-- ============================================================
-- Миграция: Маркетплейс-услуги + связь bookings → service_category
-- ============================================================

-- 1. Привязка bookings к категории услуг
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS service_category_slug VARCHAR(100);
CREATE INDEX IF NOT EXISTS idx_bookings_service_category ON bookings(service_category_slug)
  WHERE service_category_slug IS NOT NULL;

-- 2. Новые категории услуг для маркетплейсов
INSERT INTO service_categories (slug, name, description, icon, price_range, display_channels, sort_order, is_active, valid_delivery_methods)
VALUES
  ('marketplace-photo', 'Товарная фотосъёмка', 'Предметная съёмка товаров для Wildberries, Ozon, Avito', 'camera_alt', 'от 400 ₽', '{website,chatbot,pos}', 20, true, '{pickup}'),
  ('infographics', 'Инфографика карточек', 'Дизайн инфографики для карточек маркетплейсов', 'analytics', 'от 600 ₽', '{website,chatbot,pos}', 21, true, '{electronic,pickup}'),
  ('smm-content', 'SMM-контент', 'Reels, сторис, карусели для социальных сетей', 'movie_creation', 'от 2 500 ₽', '{website,chatbot,pos}', 22, true, '{electronic,pickup}'),
  ('selling-pack', 'Продающий пакет', 'Комплексный пакет: карточки + инфографика + видео', 'shopping_bag', 'от 18 000 ₽', '{website,chatbot,pos}', 23, true, '{electronic,pickup}')
ON CONFLICT (slug) DO NOTHING;

-- 3. Option groups для marketplace-photo
INSERT INTO option_groups (service_category_id, slug, name, selection_type, is_required, sort_order, is_active)
SELECT sc.id, 'package', 'Пакет съёмки', 'single', true, 1, true
FROM service_categories sc WHERE sc.slug = 'marketplace-photo'
ON CONFLICT DO NOTHING;

-- 4. Service options для marketplace-photo
INSERT INTO service_options (option_group_id, slug, name, description, base_price, price_online, price_studio, icon, features, popular, sort_order, is_active)
SELECT og.id, vals.slug, vals.name, vals.description,
       vals.base_price, vals.base_price, vals.base_price,
       vals.icon, vals.features::jsonb, vals.popular, vals.sort_order, true
FROM option_groups og
JOIN service_categories sc ON og.service_category_id = sc.id
CROSS JOIN (VALUES
  ('10-articles', '10 артикулов', 'Белый фон + детали + полная обработка', 10000, 'camera_alt', '["10 артикулов","Белый фон","Детальные кадры","Полная обработка"]'::text, true, 1),
  ('360-photo', '360° фото', 'Крупногабарит, 400–600 ₽ за штуку', 400, 'view_in_ar', '["360° поворот","Крупногабарит","Интерактивный просмотр"]'::text, false, 2),
  ('model-lifestyle', 'С моделью/lifestyle', '3–4 образа', 4000, 'person', '["3-4 образа","Модель","Lifestyle съёмка"]'::text, false, 3)
) AS vals(slug, name, description, base_price, icon, features, popular, sort_order)
WHERE sc.slug = 'marketplace-photo'
ON CONFLICT DO NOTHING;

-- price_max для диапазонных опций
UPDATE service_options SET price_max = 600, price_next_unit = 400
WHERE slug = '360-photo'
  AND option_group_id IN (
    SELECT og.id FROM option_groups og
    JOIN service_categories sc ON og.service_category_id = sc.id
    WHERE sc.slug = 'marketplace-photo'
  );

UPDATE service_options SET price_max = 7000
WHERE slug = 'model-lifestyle'
  AND option_group_id IN (
    SELECT og.id FROM option_groups og
    JOIN service_categories sc ON og.service_category_id = sc.id
    WHERE sc.slug = 'marketplace-photo'
  );

-- 5. Option groups для infographics
INSERT INTO option_groups (service_category_id, slug, name, selection_type, is_required, sort_order, is_active)
SELECT sc.id, 'package', 'Пакет инфографики', 'single', true, 1, true
FROM service_categories sc WHERE sc.slug = 'infographics'
ON CONFLICT DO NOTHING;

INSERT INTO service_options (option_group_id, slug, name, description, base_price, price_online, price_studio, icon, features, popular, sort_order, is_active)
SELECT og.id, vals.slug, vals.name, vals.description,
       vals.base_price, vals.base_price, vals.base_price,
       vals.icon, vals.features::jsonb, vals.popular, vals.sort_order, true
FROM option_groups og
JOIN service_categories sc ON og.service_category_id = sc.id
CROSS JOIN (VALUES
  ('single-card', '1 карточка', 'Иконки, размеры, плюсы, SEO-текст', 600, 'crop_original', '["Иконки","Размеры","Плюсы продукта","SEO-текст"]'::text, false, 1),
  ('pack-10', 'Пакет 10 карточек', '10 карточек инфографики', 8000, 'grid_view', '["10 карточек","Единый стиль","SEO-оптимизация"]'::text, true, 2),
  ('full-design', 'Полный дизайн + текст', 'Дизайн + копирайтинг за карточку', 1500, 'auto_awesome', '["Полный дизайн","Копирайтинг","SEO-текст","Премиум качество"]'::text, false, 3)
) AS vals(slug, name, description, base_price, icon, features, popular, sort_order)
WHERE sc.slug = 'infographics'
ON CONFLICT DO NOTHING;

UPDATE service_options SET price_max = 1000
WHERE slug = 'single-card'
  AND option_group_id IN (
    SELECT og.id FROM option_groups og
    JOIN service_categories sc ON og.service_category_id = sc.id
    WHERE sc.slug = 'infographics'
  );

UPDATE service_options SET price_max = 2500
WHERE slug = 'full-design'
  AND option_group_id IN (
    SELECT og.id FROM option_groups og
    JOIN service_categories sc ON og.service_category_id = sc.id
    WHERE sc.slug = 'infographics'
  );

-- 6. Option groups для smm-content
INSERT INTO option_groups (service_category_id, slug, name, selection_type, is_required, sort_order, is_active)
SELECT sc.id, 'package', 'Пакет SMM', 'single', true, 1, true
FROM service_categories sc WHERE sc.slug = 'smm-content'
ON CONFLICT DO NOTHING;

INSERT INTO service_options (option_group_id, slug, name, description, base_price, price_online, price_studio, icon, features, popular, sort_order, is_active)
SELECT og.id, vals.slug, vals.name, vals.description,
       vals.base_price, vals.base_price, vals.base_price,
       vals.icon, vals.features::jsonb, vals.popular, vals.sort_order, true
FROM option_groups og
JOIN service_categories sc ON og.service_category_id = sc.id
CROSS JOIN (VALUES
  ('single-reels', '1 Reels', 'Съёмка + монтаж', 2500, 'movie', '["Съёмка","Монтаж","Цветокоррекция"]'::text, false, 1),
  ('pack-5-reels', '5 Reels + 5 сторис', 'Пакет контента', 15000, 'video_library', '["5 Reels","5 сторис","Монтаж","Единый стиль"]'::text, true, 2),
  ('monthly-plan', 'Контент-план на месяц', 'Полный план + съёмка', 25000, 'calendar_month', '["Контент-план","Съёмка","Монтаж","Стратегия"]'::text, false, 3)
) AS vals(slug, name, description, base_price, icon, features, popular, sort_order)
WHERE sc.slug = 'smm-content'
ON CONFLICT DO NOTHING;

UPDATE service_options SET price_max = 4000
WHERE slug = 'single-reels'
  AND option_group_id IN (
    SELECT og.id FROM option_groups og
    JOIN service_categories sc ON og.service_category_id = sc.id
    WHERE sc.slug = 'smm-content'
  );

UPDATE service_options SET price_max = 40000
WHERE slug = 'monthly-plan'
  AND option_group_id IN (
    SELECT og.id FROM option_groups og
    JOIN service_categories sc ON og.service_category_id = sc.id
    WHERE sc.slug = 'smm-content'
  );

-- 7. Option groups для selling-pack
INSERT INTO option_groups (service_category_id, slug, name, selection_type, is_required, sort_order, is_active)
SELECT sc.id, 'package', 'Супер-пакет', 'single', true, 1, true
FROM service_categories sc WHERE sc.slug = 'selling-pack'
ON CONFLICT DO NOTHING;

INSERT INTO service_options (option_group_id, slug, name, description, base_price, price_online, price_studio, icon, features, popular, sort_order, is_active)
SELECT og.id, vals.slug, vals.name, vals.description,
       vals.base_price, vals.base_price, vals.base_price,
       vals.icon, vals.features::jsonb, vals.popular, vals.sort_order, true
FROM option_groups og
JOIN service_categories sc ON og.service_category_id = sc.id
CROSS JOIN (VALUES
  ('selling-standard', 'Продающий стандарт', '10 карточек + инфографика + 5 Reels', 18000, 'star', '["10 карточек товаров","Инфографика","5 Reels","Полная обработка"]'::text, true, 1)
) AS vals(slug, name, description, base_price, icon, features, popular, sort_order)
WHERE sc.slug = 'selling-pack'
ON CONFLICT DO NOTHING;

UPDATE service_options SET price_max = 22000
WHERE slug = 'selling-standard'
  AND option_group_id IN (
    SELECT og.id FROM option_groups og
    JOIN service_categories sc ON og.service_category_id = sc.id
    WHERE sc.slug = 'selling-pack'
  );

-- 8. Скидка 10% за объём от 3+ пакетов (selling-pack)
INSERT INTO price_modifiers (name, modifier_type, scope, service_category_id, modifier_action, modifier_value, conditions, priority, is_active)
SELECT 'Скидка за объём (3+ пакета)', 'volume', 'category', sc.id, 'multiply', 0.90, '{"min_quantity": 3}'::jsonb, 10, true
FROM service_categories sc WHERE sc.slug = 'selling-pack'
ON CONFLICT DO NOTHING;
