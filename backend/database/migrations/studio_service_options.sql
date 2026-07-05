-- Студийные услуги: недостающие записи в service_options (идемпотентно)
-- Миграция для chat-bot-engine.ts → optionSlug серверный пересчёт цен

-- Образцы визиток
INSERT INTO service_options (option_group_id, slug, name, base_price, sort_order)
SELECT 'afed0b38-d003-4dbf-9935-deb4bd2ef9f5', 'cards-samples-2', 'Образцы визиток 2 шт', 100, 25
WHERE NOT EXISTS (SELECT 1 FROM service_options WHERE slug = 'cards-samples-2');

-- Печать на карточке
INSERT INTO service_options (option_group_id, slug, name, base_price, sort_order)
SELECT 'afed0b38-d003-4dbf-9935-deb4bd2ef9f5', 'card-print', 'Печать на карточке', 120, 26
WHERE NOT EXISTS (SELECT 1 FROM service_options WHERE slug = 'card-print');

-- Студийная ретушь (отдельная от photo-docs processing-level)
INSERT INTO service_options (option_group_id, slug, name, base_price, sort_order)
SELECT 'afed0b38-d003-4dbf-9935-deb4bd2ef9f5', 'studio-retouch-basic', 'Ретушь Базовая', 600, 30
WHERE NOT EXISTS (SELECT 1 FROM service_options WHERE slug = 'studio-retouch-basic');

INSERT INTO service_options (option_group_id, slug, name, base_price, sort_order)
SELECT 'afed0b38-d003-4dbf-9935-deb4bd2ef9f5', 'studio-retouch-pro', 'Ретушь Профессиональная', 900, 31
WHERE NOT EXISTS (SELECT 1 FROM service_options WHERE slug = 'studio-retouch-pro');

INSERT INTO service_options (option_group_id, slug, name, base_price, sort_order)
SELECT 'afed0b38-d003-4dbf-9935-deb4bd2ef9f5', 'studio-retouch-premium', 'Ретушь Премиальная', 1400, 32
WHERE NOT EXISTS (SELECT 1 FROM service_options WHERE slug = 'studio-retouch-premium');

-- Реставрация: недостающие уровни
INSERT INTO service_options (option_group_id, slug, name, base_price, sort_order)
SELECT '27fe477e-cde7-45ac-9568-e53b4557b0b7', 'restore-pro', 'Профи-реставрация', 4000, 14
WHERE NOT EXISTS (SELECT 1 FROM service_options WHERE slug = 'restore-pro');

INSERT INTO service_options (option_group_id, slug, name, base_price, sort_order)
SELECT '27fe477e-cde7-45ac-9568-e53b4557b0b7', 'restore-grav', 'Реставрация под гравировку', 2000, 15
WHERE NOT EXISTS (SELECT 1 FROM service_options WHERE slug = 'restore-grav');

-- Обновление цен реставрации (синхронизация с Kontur)
UPDATE service_options SET base_price = 900 WHERE slug = 'restore-simple' AND base_price != 900;
UPDATE service_options SET base_price = 1600, name = 'Средняя реставрация' WHERE slug = 'restore-medium' AND base_price != 1600;
UPDATE service_options SET base_price = 2800, name = 'Сложная реставрация' WHERE slug = 'restore-complex' AND base_price != 2800;
