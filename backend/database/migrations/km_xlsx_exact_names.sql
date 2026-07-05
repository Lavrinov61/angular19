-- Import ALL Kontur.Market items with EXACT names from XLSX price list
-- Source: /var/www/apimain/angular-app/скриншоты/Прайс-лист от 19.03.2026.xlsx
BEGIN;

INSERT INTO option_groups (id, service_category_id, slug, name, selection_type, is_required, sort_order, is_active)
SELECT gen_random_uuid(), sc.id, 'km-drawings', 'Контур.Маркет: Чертежи', 'multi', false, 99, true
FROM service_categories sc WHERE sc.slug = 'drawings'
AND NOT EXISTS (SELECT 1 FROM option_groups og WHERE og.slug = 'km-drawings' AND og.service_category_id = sc.id);

INSERT INTO option_groups (id, service_category_id, slug, name, selection_type, is_required, sort_order, is_active)
SELECT gen_random_uuid(), sc.id, 'km-studio', 'Контур.Маркет: Студийная фотосъёмка', 'multi', false, 99, true
FROM service_categories sc WHERE sc.slug = 'photo-docs'
AND NOT EXISTS (SELECT 1 FROM option_groups og WHERE og.slug = 'km-studio' AND og.service_category_id = sc.id);

INSERT INTO option_groups (id, service_category_id, slug, name, selection_type, is_required, sort_order, is_active)
SELECT gen_random_uuid(), sc.id, 'km-frames', 'Контур.Маркет: Фоторамки', 'multi', false, 99, true
FROM service_categories sc WHERE sc.slug = 'photo-print'
AND NOT EXISTS (SELECT 1 FROM option_groups og WHERE og.slug = 'km-frames' AND og.service_category_id = sc.id);

INSERT INTO option_groups (id, service_category_id, slug, name, selection_type, is_required, sort_order, is_active)
SELECT gen_random_uuid(), sc.id, 'km-print', 'Контур.Маркет: Печать', 'multi', false, 99, true
FROM service_categories sc WHERE sc.slug = 'scan-copy'
AND NOT EXISTS (SELECT 1 FROM option_groups og WHERE og.slug = 'km-print' AND og.service_category_id = sc.id);

INSERT INTO option_groups (id, service_category_id, slug, name, selection_type, is_required, sort_order, is_active)
SELECT gen_random_uuid(), sc.id, 'km-cards', 'Контур.Маркет: Визитки/карточка', 'multi', false, 99, true
FROM service_categories sc WHERE sc.slug = 'souvenirs'
AND NOT EXISTS (SELECT 1 FROM option_groups og WHERE og.slug = 'km-cards' AND og.service_category_id = sc.id);

INSERT INTO option_groups (id, service_category_id, slug, name, selection_type, is_required, sort_order, is_active)
SELECT gen_random_uuid(), sc.id, 'km-souvenirs', 'Контур.Маркет: Сувениры и реставрация', 'multi', false, 99, true
FROM service_categories sc WHERE sc.slug = 'souvenirs'
AND NOT EXISTS (SELECT 1 FROM option_groups og WHERE og.slug = 'km-souvenirs' AND og.service_category_id = sc.id);

INSERT INTO option_groups (id, service_category_id, slug, name, selection_type, is_required, sort_order, is_active)
SELECT gen_random_uuid(), sc.id, 'km-students', 'Контур.Маркет: Студентам', 'multi', false, 99, true
FROM service_categories sc WHERE sc.slug = 'students'
AND NOT EXISTS (SELECT 1 FROM option_groups og WHERE og.slug = 'km-students' AND og.service_category_id = sc.id);

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-30x40-печать-фото', '30x40 печать фото', 450.0, 450.0, false, '[]'::jsonb, 1, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-print' AND sc.slug = 'scan-copy'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = '30x40 печать фото');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-40x50-печать-фото', '40x50 печать фото', 600.0, 600.0, false, '[]'::jsonb, 2, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-print' AND sc.slug = 'scan-copy'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = '40x50 печать фото');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-а2-42-x-60-печать-фото', 'А2 42 x 60 печать фото', 950.0, 950.0, false, '[]'::jsonb, 3, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-print' AND sc.slug = 'scan-copy'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'А2 42 x 60 печать фото');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-а3-ксерокопия', 'А3 Ксерокопия', 17.0, 17.0, false, '[]'::jsonb, 4, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-print' AND sc.slug = 'scan-copy'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'А3 Ксерокопия');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-а3-ксерокопия-фото-цветная', 'А3 Ксерокопия Фото Цветная', 60.0, 60.0, false, '[]'::jsonb, 5, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-print' AND sc.slug = 'scan-copy'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'А3 Ксерокопия Фото Цветная');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-а3-ксерокопия-цветная', 'А3 Ксерокопия Цветная', 30.0, 30.0, false, '[]'::jsonb, 6, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-print' AND sc.slug = 'scan-copy'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'А3 Ксерокопия Цветная');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-а3-печать-документа', 'А3 печать документа', 17.0, 17.0, false, '[]'::jsonb, 7, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-print' AND sc.slug = 'scan-copy'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'А3 печать документа');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-а3-фото-документ-цвет', 'А3 фото-документ цвет', 70.0, 70.0, false, '[]'::jsonb, 8, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-print' AND sc.slug = 'scan-copy'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'А3 фото-документ цвет');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-а3-фоторамка', 'А3 фоторамка', 800.0, 800.0, false, '[]'::jsonb, 9, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-frames' AND sc.slug = 'photo-print'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'А3 фоторамка');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-а3-цв-печать-чертежей', 'А3 Цв Печать чертежей', 17.0, 17.0, false, '[]'::jsonb, 10, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-drawings' AND sc.slug = 'drawings'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'А3 Цв Печать чертежей');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-а3-чб-печать-чертежей', 'А3 Чб Печать чертежей', 10.0, 10.0, false, '[]'::jsonb, 11, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-drawings' AND sc.slug = 'drawings'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'А3 Чб Печать чертежей');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-а3-чб-фото-документ', 'А3 чб фото-документ', 30.0, 30.0, false, '[]'::jsonb, 12, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-print' AND sc.slug = 'scan-copy'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'А3 чб фото-документ');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-а4-ксерокопия', 'А4 Ксерокопия', 10.0, 10.0, false, '[]'::jsonb, 13, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-print' AND sc.slug = 'scan-copy'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'А4 Ксерокопия');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-а4-ксерокопия-фото-цветная', 'А4 Ксерокопия Фото Цветная', 30.0, 30.0, false, '[]'::jsonb, 14, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-print' AND sc.slug = 'scan-copy'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'А4 Ксерокопия Фото Цветная');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-а4-ксерокопия-цветная', 'А4 Ксерокопия Цветная', 15.0, 15.0, false, '[]'::jsonb, 15, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-print' AND sc.slug = 'scan-copy'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'А4 Ксерокопия Цветная');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-а4-на-самоклеющейся-бумаге', 'А4 на Самоклеющейся бумаге', 80.0, 80.0, false, '[]'::jsonb, 16, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-print' AND sc.slug = 'scan-copy'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'А4 на Самоклеющейся бумаге');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-а4-печать-документа', 'А4 Печать документа', 10.0, 10.0, false, '[]'::jsonb, 17, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-print' AND sc.slug = 'scan-copy'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'А4 Печать документа');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-а4-печать-документа-студент', 'А4 Печать документа (студент)', 7.0, 7.0, false, '[]'::jsonb, 18, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-students' AND sc.slug = 'students'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'А4 Печать документа (студент)');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-а4-печать-документа-цветная', 'А4 Печать документа цветная', 15.0, 15.0, false, '[]'::jsonb, 19, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-print' AND sc.slug = 'scan-copy'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'А4 Печать документа цветная');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-а4-фото-документ', 'А4 фото-документ', 30.0, 30.0, false, '[]'::jsonb, 20, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-print' AND sc.slug = 'scan-copy'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'А4 фото-документ');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-а4-фото-документ-студент', 'А4 фото-документ (студент)', 15.0, 15.0, false, '[]'::jsonb, 21, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-students' AND sc.slug = 'students'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'А4 фото-документ (студент)');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-а4-фоторамка', 'А4 фоторамка', 500.0, 500.0, false, '[]'::jsonb, 22, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-frames' AND sc.slug = 'photo-print'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'А4 фоторамка');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-а4-цв-печать-чертежей', 'А4 Цв Печать чертежей', 7.0, 7.0, false, '[]'::jsonb, 23, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-drawings' AND sc.slug = 'drawings'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'А4 Цв Печать чертежей');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-а4-чб-печать-чертежей', 'А4 Чб Печать чертежей', 5.0, 5.0, false, '[]'::jsonb, 24, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-drawings' AND sc.slug = 'drawings'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'А4 Чб Печать чертежей');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-а5-фоторамка', 'А5 фоторамка', 450.0, 450.0, false, '[]'::jsonb, 25, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-frames' AND sc.slug = 'photo-print'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'А5 фоторамка');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-а6-фоторамка', 'А6 фоторамка', 400.0, 400.0, false, '[]'::jsonb, 26, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-frames' AND sc.slug = 'photo-print'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'А6 фоторамка');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-визитки-бумага-100-шт', 'Визитки (бумага) 100 шт', 600.0, 600.0, false, '[]'::jsonb, 27, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-print' AND sc.slug = 'scan-copy'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'Визитки (бумага) 100 шт');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-визитки-бумага-100-шт', 'Визитки (бумага) 100 шт.', 600.0, 600.0, false, '[]'::jsonb, 28, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-cards' AND sc.slug = 'souvenirs'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'Визитки (бумага) 100 шт.');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-визитки-образцы-2-шт', 'Визитки (образцы) 2 шт.', 100.0, 100.0, false, '[]'::jsonb, 29, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-cards' AND sc.slug = 'souvenirs'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'Визитки (образцы) 2 шт.');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-визитки-пластик-50-шт', 'Визитки (пластик) 50 шт.', 1000.0, 1000.0, false, '[]'::jsonb, 30, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-cards' AND sc.slug = 'souvenirs'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'Визитки (пластик) 50 шт.');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-печать-на-кружках', 'Печать на кружках', 390.0, 390.0, false, '[]'::jsonb, 31, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-souvenirs' AND sc.slug = 'souvenirs'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'Печать на кружках');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-печать-на-холсте-30x40', 'Печать на холсте 30x40', 2200.0, 2200.0, false, '[]'::jsonb, 32, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-souvenirs' AND sc.slug = 'souvenirs'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'Печать на холсте 30x40');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-печать-на-холсте-50x70', 'Печать на холсте 50x70', 3400.0, 3400.0, false, '[]'::jsonb, 33, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-souvenirs' AND sc.slug = 'souvenirs'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'Печать на холсте 50x70');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-печать-на-холсте-70x100', 'Печать на холсте 70x100', 4300.0, 4300.0, false, '[]'::jsonb, 34, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-souvenirs' AND sc.slug = 'souvenirs'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'Печать на холсте 70x100');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-портретное-фото-бизнес-резюме-реклама-и-тд', 'Портретное фото (бизнес, резюме, реклама и тд.)', 900.0, 900.0, false, '[]'::jsonb, 35, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-studio' AND sc.slug = 'photo-docs'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'Портретное фото (бизнес, резюме, реклама и тд.)');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-реставрация-фото-под-гравировку', 'Реставрация фото (под гравировку)', 2000.0, 2000.0, false, '[]'::jsonb, 36, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-souvenirs' AND sc.slug = 'souvenirs'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'Реставрация фото (под гравировку)');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-реставрация-фото-простая', 'Реставрация фото (простая)', 900.0, 900.0, false, '[]'::jsonb, 37, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-souvenirs' AND sc.slug = 'souvenirs'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'Реставрация фото (простая)');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-реставрация-фото-профи', 'Реставрация фото (профи)', 4000.0, 4000.0, false, '[]'::jsonb, 38, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-souvenirs' AND sc.slug = 'souvenirs'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'Реставрация фото (профи)');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-реставрация-фото-сложная', 'Реставрация фото (сложная)', 2800.0, 2800.0, false, '[]'::jsonb, 39, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-souvenirs' AND sc.slug = 'souvenirs'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'Реставрация фото (сложная)');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-реставрация-фото-средняя', 'Реставрация фото (средняя)', 1600.0, 1600.0, false, '[]'::jsonb, 40, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-souvenirs' AND sc.slug = 'souvenirs'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'Реставрация фото (средняя)');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-фото-10x15-премиум', 'Фото 10x15 премиум', 19.5, 19.5, false, '[]'::jsonb, 41, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-print' AND sc.slug = 'scan-copy'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'Фото 10x15 премиум');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-фото-10x15-супер', 'Фото 10x15 супер', 36.0, 36.0, false, '[]'::jsonb, 42, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-print' AND sc.slug = 'scan-copy'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'Фото 10x15 супер');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-фото-15x20-премиум', 'Фото 15x20 премиум', 49.0, 49.0, false, '[]'::jsonb, 43, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-print' AND sc.slug = 'scan-copy'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'Фото 15x20 премиум');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-фото-15x20-супер', 'Фото 15x20 супер', 70.0, 70.0, false, '[]'::jsonb, 44, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-print' AND sc.slug = 'scan-copy'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'Фото 15x20 супер');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-фото-20x30-премиум', 'Фото 20x30 премиум', 117.0, 117.0, false, '[]'::jsonb, 45, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-print' AND sc.slug = 'scan-copy'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'Фото 20x30 премиум');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-фото-20x30-супер', 'Фото 20x30 супер', 140.0, 140.0, false, '[]'::jsonb, 46, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-print' AND sc.slug = 'scan-copy'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'Фото 20x30 супер');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-фото-на-документы-паспорт-загран-студ-и-тд', 'Фото на документы (паспорт, загран, студ. и тд.)', 700.0, 700.0, false, '[]'::jsonb, 47, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-studio' AND sc.slug = 'photo-docs'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'Фото на документы (паспорт, загран, студ. и тд.)');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-фото-на-другие-документы', 'Фото на другие документы', 700.0, 700.0, false, '[]'::jsonb, 48, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-studio' AND sc.slug = 'photo-docs'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'Фото на другие документы');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-фото-на-загран', 'Фото на загран', 700.0, 700.0, false, '[]'::jsonb, 49, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-studio' AND sc.slug = 'photo-docs'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'Фото на загран');

INSERT INTO service_options (id, option_group_id, slug, name, base_price, price_studio, popular, features, sort_order, is_active, icon)
SELECT gen_random_uuid(), og.id, 'km-фото-на-паспорт', 'Фото на паспорт', 700.0, 700.0, false, '[]'::jsonb, 50, true, 'sell'
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'km-studio' AND sc.slug = 'photo-docs'
AND NOT EXISTS (SELECT 1 FROM service_options so WHERE so.name = 'Фото на паспорт');

COMMIT;