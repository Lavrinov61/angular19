-- ===========================================================================
-- Контур.Маркет → Pricing Engine: полный импорт 91 позиции
-- Дата: 2026-03-19
-- Идемпотентная миграция (ON CONFLICT DO UPDATE / DO NOTHING)
-- ===========================================================================

BEGIN;

-- ===========================
-- 1. НОВЫЕ КАТЕГОРИИ
-- ===========================

-- Чертежи
INSERT INTO service_categories (slug, name, description, icon, sort_order, is_active, display_channels)
VALUES ('drawings', 'Печать чертежей', 'Печать чертежей А3/А4 цветная и ч/б', 'straighten', 15, true, '{pos}')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  updated_at = now();

-- Студентам
INSERT INTO service_categories (slug, name, description, icon, sort_order, is_active, display_channels)
VALUES ('students', 'Студентам', 'Скидки для студентов на печать и фото', 'school', 16, true, '{pos}')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  updated_at = now();

-- Услуги (misc) — дополнительные услуги не вошедшие в другие категории
INSERT INTO service_categories (slug, name, description, icon, sort_order, is_active, display_channels)
VALUES ('misc-services', 'Дополнительные услуги', 'Кадрирование, запись на диск, индивидуальные заказы и пр.', 'build', 25, true, '{pos}')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  updated_at = now();

-- Выездная фотосъёмка
INSERT INTO service_categories (slug, name, description, icon, sort_order, is_active, display_channels)
VALUES ('event-photo', 'Выездная фотосъёмка', 'Фотосъёмка событий, репортажей, мероприятий', 'camera_outdoor', 5, true, '{pos,website}')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  updated_at = now();

-- Портфолио
INSERT INTO service_categories (slug, name, description, icon, sort_order, is_active, display_channels)
VALUES ('portfolio', 'Портфолио', 'Портретная фотография и ретушь для портфолио', 'photo_library', 7, true, '{pos}')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  updated_at = now();

-- ===========================
-- 2. НОВЫЕ ГРУППЫ ОПЦИЙ
-- ===========================

-- Чертежи → одна группа
INSERT INTO option_groups (service_category_id, slug, name, selection_type, sort_order, is_active)
SELECT sc.id, 'drawing-type', 'Тип чертежа', 'single', 1, true
FROM service_categories sc WHERE sc.slug = 'drawings'
ON CONFLICT (service_category_id, slug) DO NOTHING;

-- Студентам → одна группа
INSERT INTO option_groups (service_category_id, slug, name, selection_type, sort_order, is_active)
SELECT sc.id, 'student-service', 'Услуга для студента', 'single', 1, true
FROM service_categories sc WHERE sc.slug = 'students'
ON CONFLICT (service_category_id, slug) DO NOTHING;

-- Доп. услуги → одна группа
INSERT INTO option_groups (service_category_id, slug, name, selection_type, sort_order, is_active)
SELECT sc.id, 'misc-type', 'Тип услуги', 'single', 1, true
FROM service_categories sc WHERE sc.slug = 'misc-services'
ON CONFLICT (service_category_id, slug) DO NOTHING;

-- Выездная фотосъёмка → одна группа
INSERT INTO option_groups (service_category_id, slug, name, selection_type, sort_order, is_active)
SELECT sc.id, 'event-type', 'Тип мероприятия', 'single', 1, true
FROM service_categories sc WHERE sc.slug = 'event-photo'
ON CONFLICT (service_category_id, slug) DO NOTHING;

-- Портфолио → одна группа
INSERT INTO option_groups (service_category_id, slug, name, selection_type, sort_order, is_active)
SELECT sc.id, 'portfolio-type', 'Тип услуги', 'single', 1, true
FROM service_categories sc WHERE sc.slug = 'portfolio'
ON CONFLICT (service_category_id, slug) DO NOTHING;

-- ===========================
-- 3. ОБНОВЛЕНИЕ СУЩЕСТВУЮЩИХ ОПЦИЙ (price_studio)
-- ===========================

-- photo-print: 10x15-premium 19→20
UPDATE service_options SET price_studio = 20.00, updated_at = now()
WHERE slug = '10x15-premium'
  AND option_group_id = (
    SELECT og.id FROM option_groups og
    JOIN service_categories sc ON sc.id = og.service_category_id
    WHERE sc.slug = 'photo-print' AND og.slug = 'photo-format'
  );

-- photo-restore: restore-pro — добавить price_studio из КМ (4000)
UPDATE service_options SET price_studio = 4000.00, updated_at = now()
WHERE slug = 'restore-pro'
  AND option_group_id = (
    SELECT og.id FROM option_groups og
    JOIN service_categories sc ON sc.id = og.service_category_id
    WHERE sc.slug = 'photo-restore' AND og.slug = 'complexity'
  );

-- photo-restore: restore-grav — добавить price_studio из КМ (2000)
UPDATE service_options SET price_studio = 2000.00, updated_at = now()
WHERE slug = 'restore-grav'
  AND option_group_id = (
    SELECT og.id FROM option_groups og
    JOIN service_categories sc ON sc.id = og.service_category_id
    WHERE sc.slug = 'photo-restore' AND og.slug = 'complexity'
  );

-- photo-restore: restore-simple — обновить price_studio (КМ=900, было 450)
UPDATE service_options SET price_studio = 900.00, updated_at = now()
WHERE slug = 'restore-simple'
  AND option_group_id = (
    SELECT og.id FROM option_groups og
    JOIN service_categories sc ON sc.id = og.service_category_id
    WHERE sc.slug = 'photo-restore' AND og.slug = 'complexity'
  );

-- photo-restore: restore-medium — обновить price_studio (КМ=1600, было 900)
UPDATE service_options SET price_studio = 1600.00, updated_at = now()
WHERE slug = 'restore-medium'
  AND option_group_id = (
    SELECT og.id FROM option_groups og
    JOIN service_categories sc ON sc.id = og.service_category_id
    WHERE sc.slug = 'photo-restore' AND og.slug = 'complexity'
  );

-- photo-restore: restore-complex — обновить price_studio (КМ=2800, было 1800)
UPDATE service_options SET price_studio = 2800.00, updated_at = now()
WHERE slug = 'restore-complex'
  AND option_group_id = (
    SELECT og.id FROM option_groups og
    JOIN service_categories sc ON sc.id = og.service_category_id
    WHERE sc.slug = 'photo-restore' AND og.slug = 'complexity'
  );

-- souvenirs: studio-retouch-basic — price_studio=600
UPDATE service_options SET price_studio = 600.00, updated_at = now()
WHERE slug = 'studio-retouch-basic'
  AND option_group_id = (
    SELECT og.id FROM option_groups og
    JOIN service_categories sc ON sc.id = og.service_category_id
    WHERE sc.slug = 'souvenirs' AND og.slug = 'souvenir-type'
  );

-- souvenirs: studio-retouch-pro — price_studio=900
UPDATE service_options SET price_studio = 900.00, updated_at = now()
WHERE slug = 'studio-retouch-pro'
  AND option_group_id = (
    SELECT og.id FROM option_groups og
    JOIN service_categories sc ON sc.id = og.service_category_id
    WHERE sc.slug = 'souvenirs' AND og.slug = 'souvenir-type'
  );

-- souvenirs: studio-retouch-premium — price_studio=1400
UPDATE service_options SET price_studio = 1400.00, updated_at = now()
WHERE slug = 'studio-retouch-premium'
  AND option_group_id = (
    SELECT og.id FROM option_groups og
    JOIN service_categories sc ON sc.id = og.service_category_id
    WHERE sc.slug = 'souvenirs' AND og.slug = 'souvenir-type'
  );

-- souvenirs: cards-samples-2 — price_studio=100
UPDATE service_options SET price_studio = 100.00, updated_at = now()
WHERE slug = 'cards-samples-2'
  AND option_group_id = (
    SELECT og.id FROM option_groups og
    JOIN service_categories sc ON sc.id = og.service_category_id
    WHERE sc.slug = 'souvenirs' AND og.slug = 'souvenir-type'
  );

-- souvenirs: card-print — price_studio=120
UPDATE service_options SET price_studio = 120.00, updated_at = now()
WHERE slug = 'card-print'
  AND option_group_id = (
    SELECT og.id FROM option_groups og
    JOIN service_categories sc ON sc.id = og.service_category_id
    WHERE sc.slug = 'souvenirs' AND og.slug = 'souvenir-type'
  );

-- ===========================
-- 4. НОВЫЕ service_options
-- ===========================

-- -----------------------------------------------
-- 4a. photo-docs → document-type: новые типы
-- -----------------------------------------------

INSERT INTO service_options (option_group_id, slug, name, base_price, price_studio, price_online, popular, features, sort_order)
SELECT og.id, 'photo-greencard', 'Фото на Грин-Карту', 900.00, 900.00, NULL, false, '["Формат 5x5 см", "Белый фон", "Стандарт US"]'::jsonb, 20
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE sc.slug = 'photo-docs' AND og.slug = 'document-type'
ON CONFLICT (option_group_id, slug) DO UPDATE SET
  price_studio = 900.00, updated_at = now();

INSERT INTO service_options (option_group_id, slug, name, base_price, price_studio, price_online, popular, features, sort_order)
SELECT og.id, 'urgent-photo-docs', 'Срочные фото на документы', 900.00, 900.00, NULL, false, '["Готовность 15 минут", "Любой документ"]'::jsonb, 21
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE sc.slug = 'photo-docs' AND og.slug = 'document-type'
ON CONFLICT (option_group_id, slug) DO UPDATE SET
  price_studio = 900.00, updated_at = now();

-- -----------------------------------------------
-- 4b. photo-docs → extras: портретное фото
-- -----------------------------------------------

INSERT INTO service_options (option_group_id, slug, name, base_price, price_studio, price_online, popular, features, sort_order)
SELECT og.id, 'portrait-business', 'Портретное фото (бизнес, резюме)', 900.00, 900.00, NULL, false, '["Бизнес-портрет", "Для резюме и LinkedIn", "Профессиональная ретушь"]'::jsonb, 10
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE sc.slug = 'photo-docs' AND og.slug = 'extras'
ON CONFLICT (option_group_id, slug) DO UPDATE SET
  price_studio = 900.00, updated_at = now();

-- -----------------------------------------------
-- 4c. scan-copy → scan-copy-type: новые позиции
-- -----------------------------------------------

INSERT INTO service_options (option_group_id, slug, name, base_price, price_studio, popular, features, sort_order)
SELECT og.id, 'copy-a4-photo-color', 'Ксерокопия А4 фото цветная', 30.00, 30.00, false, '["Фотокачество", "Цветная", "А4"]'::jsonb, 15
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE sc.slug = 'scan-copy' AND og.slug = 'scan-copy-type'
ON CONFLICT (option_group_id, slug) DO UPDATE SET
  price_studio = 30.00, updated_at = now();

INSERT INTO service_options (option_group_id, slug, name, base_price, price_studio, popular, features, sort_order)
SELECT og.id, 'copy-a3-photo-color', 'Ксерокопия А3 фото цветная', 60.00, 60.00, false, '["Фотокачество", "Цветная", "А3"]'::jsonb, 16
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE sc.slug = 'scan-copy' AND og.slug = 'scan-copy-type'
ON CONFLICT (option_group_id, slug) DO UPDATE SET
  price_studio = 60.00, updated_at = now();

INSERT INTO service_options (option_group_id, slug, name, base_price, price_studio, popular, features, sort_order)
SELECT og.id, 'photo-doc-a4', 'Фото-документ А4', 30.00, 30.00, false, '["Фотопечать", "А4"]'::jsonb, 17
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE sc.slug = 'scan-copy' AND og.slug = 'scan-copy-type'
ON CONFLICT (option_group_id, slug) DO UPDATE SET
  price_studio = 30.00, updated_at = now();

INSERT INTO service_options (option_group_id, slug, name, base_price, price_studio, popular, features, sort_order)
SELECT og.id, 'photo-doc-a3-color', 'Фото-документ А3 цветной', 70.00, 70.00, false, '["Фотокачество", "Цветная", "А3"]'::jsonb, 18
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE sc.slug = 'scan-copy' AND og.slug = 'scan-copy-type'
ON CONFLICT (option_group_id, slug) DO UPDATE SET
  price_studio = 70.00, updated_at = now();

INSERT INTO service_options (option_group_id, slug, name, base_price, price_studio, popular, features, sort_order)
SELECT og.id, 'photo-doc-a3-bw', 'Фото-документ А3 ч/б', 30.00, 30.00, false, '["Фотокачество", "Ч/Б", "А3"]'::jsonb, 19
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE sc.slug = 'scan-copy' AND og.slug = 'scan-copy-type'
ON CONFLICT (option_group_id, slug) DO UPDATE SET
  price_studio = 30.00, updated_at = now();

INSERT INTO service_options (option_group_id, slug, name, base_price, price_studio, popular, features, sort_order)
SELECT og.id, 'print-a4-adhesive', 'Печать А4 на самоклеющейся бумаге', 80.00, 80.00, false, '["Самоклеющаяся бумага", "А4"]'::jsonb, 20
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE sc.slug = 'scan-copy' AND og.slug = 'scan-copy-type'
ON CONFLICT (option_group_id, slug) DO UPDATE SET
  price_studio = 80.00, updated_at = now();

INSERT INTO service_options (option_group_id, slug, name, base_price, price_studio, popular, features, sort_order)
SELECT og.id, 'file-sleeve', 'Файлик', 5.00, 5.00, false, '["Прозрачный файл"]'::jsonb, 30
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE sc.slug = 'scan-copy' AND og.slug = 'scan-copy-type'
ON CONFLICT (option_group_id, slug) DO UPDATE SET
  price_studio = 5.00, updated_at = now();

INSERT INTO service_options (option_group_id, slug, name, base_price, price_studio, popular, features, sort_order)
SELECT og.id, 'cutting', 'Резка', 10.00, 10.00, false, '["Резка бумаги/фото"]'::jsonb, 31
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE sc.slug = 'scan-copy' AND og.slug = 'scan-copy-type'
ON CONFLICT (option_group_id, slug) DO UPDATE SET
  price_studio = 10.00, updated_at = now();

-- -----------------------------------------------
-- 4d. photo-print → photo-format: А2
-- -----------------------------------------------

INSERT INTO service_options (option_group_id, slug, name, base_price, price_studio, popular, features, sort_order)
SELECT og.id, 'photo-a2', 'Фото А2 (42×60)', 950.00, 950.00, false, '["Широкоформатная печать", "42×60 см"]'::jsonb, 20
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE sc.slug = 'photo-print' AND og.slug = 'photo-format'
ON CONFLICT (option_group_id, slug) DO UPDATE SET
  price_studio = 950.00, updated_at = now();

-- -----------------------------------------------
-- 4e. photo-print → photo-extras: визитки бумажные (дубль с souvenirs, но в КМ "Печать")
-- Уже в souvenirs, не дублируем
-- -----------------------------------------------

-- -----------------------------------------------
-- 4f. Чертежи → drawing-type
-- -----------------------------------------------

INSERT INTO service_options (option_group_id, slug, name, base_price, price_studio, popular, features, sort_order)
SELECT og.id, 'drawing-a3-color', 'А3 цветной чертёж', 17.00, 17.00, false, '["Цветная печать", "А3"]'::jsonb, 1
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE sc.slug = 'drawings' AND og.slug = 'drawing-type'
ON CONFLICT (option_group_id, slug) DO UPDATE SET
  price_studio = 17.00, updated_at = now();

INSERT INTO service_options (option_group_id, slug, name, base_price, price_studio, popular, features, sort_order)
SELECT og.id, 'drawing-a3-bw', 'А3 ч/б чертёж', 10.00, 10.00, false, '["Ч/Б печать", "А3"]'::jsonb, 2
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE sc.slug = 'drawings' AND og.slug = 'drawing-type'
ON CONFLICT (option_group_id, slug) DO UPDATE SET
  price_studio = 10.00, updated_at = now();

INSERT INTO service_options (option_group_id, slug, name, base_price, price_studio, popular, features, sort_order)
SELECT og.id, 'drawing-a4-color', 'А4 цветной чертёж', 7.00, 7.00, false, '["Цветная печать", "А4"]'::jsonb, 3
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE sc.slug = 'drawings' AND og.slug = 'drawing-type'
ON CONFLICT (option_group_id, slug) DO UPDATE SET
  price_studio = 7.00, updated_at = now();

INSERT INTO service_options (option_group_id, slug, name, base_price, price_studio, popular, features, sort_order)
SELECT og.id, 'drawing-a4-bw', 'А4 ч/б чертёж', 5.00, 5.00, false, '["Ч/Б печать", "А4"]'::jsonb, 4
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE sc.slug = 'drawings' AND og.slug = 'drawing-type'
ON CONFLICT (option_group_id, slug) DO UPDATE SET
  price_studio = 5.00, updated_at = now();

-- -----------------------------------------------
-- 4g. Студентам → student-service
-- -----------------------------------------------

INSERT INTO service_options (option_group_id, slug, name, base_price, price_studio, popular, features, sort_order)
SELECT og.id, 'student-print-a4', 'Печать А4 (студент)', 7.00, 7.00, false, '["Печать документа", "А4", "Скидка для студентов"]'::jsonb, 1
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE sc.slug = 'students' AND og.slug = 'student-service'
ON CONFLICT (option_group_id, slug) DO UPDATE SET
  price_studio = 7.00, updated_at = now();

INSERT INTO service_options (option_group_id, slug, name, base_price, price_studio, popular, features, sort_order)
SELECT og.id, 'student-photo-doc-a4', 'Фото-документ А4 (студент)', 15.00, 15.00, false, '["Фото-документ", "А4", "Скидка для студентов"]'::jsonb, 2
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE sc.slug = 'students' AND og.slug = 'student-service'
ON CONFLICT (option_group_id, slug) DO UPDATE SET
  price_studio = 15.00, updated_at = now();

-- -----------------------------------------------
-- 4h. Доп. услуги → misc-type
-- -----------------------------------------------

INSERT INTO service_options (option_group_id, slug, name, base_price, price_studio, popular, features, sort_order)
SELECT og.id, 'cropping', 'Кадрирование', 50.00, 50.00, false, '["Обрезка фото по размеру"]'::jsonb, 1
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE sc.slug = 'misc-services' AND og.slug = 'misc-type'
ON CONFLICT (option_group_id, slug) DO UPDATE SET
  price_studio = 50.00, updated_at = now();

INSERT INTO service_options (option_group_id, slug, name, base_price, price_studio, popular, features, sort_order)
SELECT og.id, 'disc-recording', 'Запись на диск', 100.00, 100.00, false, '["CD/DVD запись"]'::jsonb, 2
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE sc.slug = 'misc-services' AND og.slug = 'misc-type'
ON CONFLICT (option_group_id, slug) DO UPDATE SET
  price_studio = 100.00, updated_at = now();

INSERT INTO service_options (option_group_id, slug, name, base_price, price_studio, popular, features, sort_order)
SELECT og.id, 'custom-order', 'Индивидуальный заказ', 500.00, 500.00, false, '["Персональный заказ", "Цена от 500₽"]'::jsonb, 3
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE sc.slug = 'misc-services' AND og.slug = 'misc-type'
ON CONFLICT (option_group_id, slug) DO UPDATE SET
  price_studio = 500.00, updated_at = now();

INSERT INTO service_options (option_group_id, slug, name, base_price, price_studio, popular, features, sort_order)
SELECT og.id, 'immortal-regiment', 'Бессмертный полк', 900.00, 900.00, false, '["Портрет для шествия", "Печать + ламинация"]'::jsonb, 4
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE sc.slug = 'misc-services' AND og.slug = 'misc-type'
ON CONFLICT (option_group_id, slug) DO UPDATE SET
  price_studio = 900.00, updated_at = now();

INSERT INTO service_options (option_group_id, slug, name, base_price, price_studio, popular, features, sort_order)
SELECT og.id, 'memorial-photo', 'Фото на памятник', 1000.00, 1000.00, false, '["Обработка фото", "Печать для памятника"]'::jsonb, 5
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE sc.slug = 'misc-services' AND og.slug = 'misc-type'
ON CONFLICT (option_group_id, slug) DO UPDATE SET
  price_studio = 1000.00, updated_at = now();

INSERT INTO service_options (option_group_id, slug, name, base_price, price_studio, popular, features, sort_order)
SELECT og.id, 'polaroid-reportage', 'Полароид для репортажной фотосъёмки', 100.00, 100.00, false, '["Моментальное фото", "Для мероприятий"]'::jsonb, 6
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE sc.slug = 'misc-services' AND og.slug = 'misc-type'
ON CONFLICT (option_group_id, slug) DO UPDATE SET
  price_studio = 100.00, updated_at = now();

INSERT INTO service_options (option_group_id, slug, name, base_price, price_studio, popular, features, sort_order)
SELECT og.id, 'retouch-reportage', 'Ретушь репортажной фотосъёмки', 200.00, 200.00, false, '["Обработка репортажных фото"]'::jsonb, 7
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE sc.slug = 'misc-services' AND og.slug = 'misc-type'
ON CONFLICT (option_group_id, slug) DO UPDATE SET
  price_studio = 200.00, updated_at = now();

-- -----------------------------------------------
-- 4i. Выездная фотосъёмка → event-type
-- -----------------------------------------------

INSERT INTO service_options (option_group_id, slug, name, base_price, price_studio, popular, features, sort_order)
SELECT og.id, 'event-photography', 'Фотосъёмка событий', 4500.00, 4500.00, false, '["Выезд фотографа", "До 2 часов съёмки", "Обработка фото"]'::jsonb, 1
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE sc.slug = 'event-photo' AND og.slug = 'event-type'
ON CONFLICT (option_group_id, slug) DO UPDATE SET
  price_studio = 4500.00, updated_at = now();

-- -----------------------------------------------
-- 4j. Портфолио → portfolio-type
-- -----------------------------------------------

INSERT INTO service_options (option_group_id, slug, name, base_price, price_studio, popular, features, sort_order)
SELECT og.id, 'portrait-photo', 'Портрет', 100.00, 100.00, false, '["Портретная фотография"]'::jsonb, 1
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE sc.slug = 'portfolio' AND og.slug = 'portfolio-type'
ON CONFLICT (option_group_id, slug) DO UPDATE SET
  price_studio = 100.00, updated_at = now();

INSERT INTO service_options (option_group_id, slug, name, base_price, price_studio, popular, features, sort_order)
SELECT og.id, 'portfolio-retouch', 'Ретушь', 100.00, 100.00, false, '["Ретушь для портфолио"]'::jsonb, 2
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE sc.slug = 'portfolio' AND og.slug = 'portfolio-type'
ON CONFLICT (option_group_id, slug) DO UPDATE SET
  price_studio = 100.00, updated_at = now();

-- ===========================
-- 5. ВЕРИФИКАЦИЯ
-- ===========================

DO $$
DECLARE
  cat_count INTEGER;
  group_count INTEGER;
  option_count INTEGER;
BEGIN
  SELECT count(*) INTO cat_count FROM service_categories WHERE is_active = true;
  SELECT count(*) INTO group_count FROM option_groups WHERE is_active = true;
  SELECT count(*) INTO option_count FROM service_options WHERE is_active = true;

  RAISE NOTICE 'Контур.Маркет импорт завершён:';
  RAISE NOTICE '  Категорий: %', cat_count;
  RAISE NOTICE '  Групп: %', group_count;
  RAISE NOTICE '  Опций: %', option_count;
END $$;

COMMIT;
