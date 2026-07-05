-- Sprint 5: Полная переработка ценообразования фото на документы
-- + подписки 199₽ вход + динамическая ретушь
-- Applied: 2026-03-27
-- Idempotent: safe to re-run

BEGIN;

-- ============================================================================
-- 1. ДЕАКТИВАЦИЯ СТАРЫХ ПОДПИСОЧНЫХ ПЛАНОВ (все 28)
-- ============================================================================
UPDATE subscription_plans SET is_active = false, updated_at = now()
WHERE slug NOT LIKE 'launch-%';

-- ============================================================================
-- 2. ДЕАКТИВАЦИЯ СТАРОГО "УРОВНЯ ОБРАБОТКИ" (пакетная ретушь)
-- ============================================================================
UPDATE service_options SET is_active = false
WHERE slug IN ('retouch', 'basic', 'vip', 'vip-all-docs', 'studio-retouch');

-- ============================================================================
-- 3. ДЕАКТИВАЦИЯ ЛИШНИХ ПОЗИЦИЙ
-- ============================================================================
UPDATE service_options SET is_active = false
WHERE slug IN ('all-docs-bundle', 'print-delivery', 'face-cleanup');

UPDATE products SET is_active = false
WHERE code IN ('all-docs-bundle', 'print-delivery');

-- ============================================================================
-- 4. НОВЫЕ УРОВНИ ОБРАБОТКИ (динамическая ретушь — группы операций)
-- ============================================================================

-- Без обработки
INSERT INTO service_options (name, slug, base_price, price_studio, price_online, option_group_id, sort_order, is_active, features)
SELECT 'Без обработки', 'processing-none', 0, 0, 0, og.id, 5, true, '[]'::jsonb
FROM option_groups og WHERE og.slug = 'processing-level'
AND NOT EXISTS (SELECT 1 FROM service_options WHERE slug = 'processing-none');
UPDATE service_options SET is_active = true, base_price = 0, price_studio = 0, price_online = 0 WHERE slug = 'processing-none';

-- Базовая: чистка лица + чистка фона + выравнивание плеч + коррекция причёски = 700₽
INSERT INTO service_options (name, slug, base_price, price_studio, price_online, option_group_id, sort_order, is_active, features)
SELECT 'Базовая обработка', 'processing-basic', 700, 700, 700, og.id, 10, true,
  '["Чистка лица", "Чистка фона", "Выравнивание плеч", "Коррекция причёски"]'::jsonb
FROM option_groups og WHERE og.slug = 'processing-level'
AND NOT EXISTS (SELECT 1 FROM service_options WHERE slug = 'processing-basic');
UPDATE service_options SET is_active = true, base_price = 700, price_studio = 700, price_online = 700,
  features = '["Чистка лица", "Чистка фона", "Выравнивание плеч", "Коррекция причёски"]'::jsonb
WHERE slug = 'processing-basic';

-- Расширенная: базовая + очки/блики = 950₽
INSERT INTO service_options (name, slug, base_price, price_studio, price_online, option_group_id, sort_order, is_active, features)
SELECT 'Расширенная обработка', 'processing-extended', 950, 950, 950, og.id, 20, true,
  '["Чистка лица", "Чистка фона", "Выравнивание плеч", "Коррекция причёски", "Убрать очки/блики"]'::jsonb
FROM option_groups og WHERE og.slug = 'processing-level'
AND NOT EXISTS (SELECT 1 FROM service_options WHERE slug = 'processing-extended');
UPDATE service_options SET is_active = true, base_price = 950, price_studio = 950, price_online = 950,
  features = '["Чистка лица", "Чистка фона", "Выравнивание плеч", "Коррекция причёски", "Убрать очки/блики"]'::jsonb
WHERE slug = 'processing-extended';

-- Максимальная: расширенная + морщины + подбородок = 1400₽
INSERT INTO service_options (name, slug, base_price, price_studio, price_online, option_group_id, sort_order, is_active, features)
SELECT 'Максимальная обработка', 'processing-max', 1400, 1400, 1400, og.id, 30, true,
  '["Чистка лица", "Чистка фона", "Выравнивание плеч", "Коррекция причёски", "Убрать очки/блики", "Убрать морщины", "Убрать второй подбородок"]'::jsonb
FROM option_groups og WHERE og.slug = 'processing-level'
AND NOT EXISTS (SELECT 1 FROM service_options WHERE slug = 'processing-max');
UPDATE service_options SET is_active = true, base_price = 1400, price_studio = 1400, price_online = 1400,
  features = '["Чистка лица", "Чистка фона", "Выравнивание плеч", "Коррекция причёски", "Убрать очки/блики", "Убрать морщины", "Убрать второй подбородок"]'::jsonb
WHERE slug = 'processing-max';

-- ============================================================================
-- 5. ДОПОЛНЕНИЯ — подстановка формы 290₽ единая + новые допы
-- ============================================================================

-- Подстановка формы: студия 160→290
UPDATE service_options SET price_studio = 290.00 WHERE slug = 'uniform';

-- Коррекция освещения — 250₽
INSERT INTO service_options (name, slug, base_price, price_studio, price_online, option_group_id, sort_order, is_active, features)
SELECT 'Коррекция освещения', 'lighting-fix', 250, 250, 250, og.id, 20, true,
  '["Исправление теней", "Выравнивание света", "Для селфи и домашних фото"]'::jsonb
FROM option_groups og
WHERE og.slug = 'extras' AND og.service_category_id = (SELECT id FROM service_categories WHERE slug = 'photo-docs')
AND NOT EXISTS (SELECT 1 FROM service_options WHERE slug = 'lighting-fix'
  AND option_group_id = (SELECT id FROM option_groups WHERE slug = 'extras' AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'photo-docs')));

-- Медали и награды — 390₽
INSERT INTO service_options (name, slug, base_price, price_studio, price_online, option_group_id, sort_order, is_active, features)
SELECT 'Медали и награды', 'medals-overlay', 390, 390, 390, og.id, 30, true,
  '["Подстановка медалей", "Нагрудные знаки", "Ордена и награды"]'::jsonb
FROM option_groups og
WHERE og.slug = 'extras' AND og.service_category_id = (SELECT id FROM service_categories WHERE slug = 'photo-docs')
AND NOT EXISTS (SELECT 1 FROM service_options WHERE slug = 'medals-overlay'
  AND option_group_id = (SELECT id FROM option_groups WHERE slug = 'extras' AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'photo-docs')));

-- ============================================================================
-- 6. ПОДПИСКИ — 13 планов, 5 категорий, вход 199₽
-- (launch-* планы созданы в subscription_launch_v7.sql и _v7_complete.sql)
-- Обновляем Лайт планы до 199₽
-- ============================================================================
UPDATE subscription_plans SET base_price = 199.00, updated_at = now()
WHERE slug IN ('launch-docs-lite', 'launch-photoprint-lite', 'launch-printscan-lite', 'launch-retouch-lite', 'launch-scan-lite')
  AND is_active = true;

COMMIT;
