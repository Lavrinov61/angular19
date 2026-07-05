-- Реорганизация категорий POS по образцу Контур.Маркета
-- 21 категория услуг + существующие материальные категории (смещены вниз)
-- Идемпотентная миграция: ON CONFLICT по name, безопасные UPDATE

BEGIN;

-- =============================================================
-- 1. Переименование существующих категорий (если нужно)
-- =============================================================

-- "Рамки" → "Фоторамки" (sort 10)
UPDATE product_categories SET name = 'Фоторамки' WHERE name = 'Рамки';

-- "Сувенирная продукция" → "Сувениры и реставрация" (sort 18)
UPDATE product_categories SET name = 'Сувениры и реставрация' WHERE name = 'Сувенирная продукция';

-- =============================================================
-- 2. INSERT новых категорий (ON CONFLICT DO NOTHING — идемпотентно)
-- =============================================================

-- Ряд 1 (sort 1-5)
INSERT INTO product_categories (name, sort_order, is_active) VALUES
  ('Фото на студенческий', 1, true)
ON CONFLICT (name) DO UPDATE SET sort_order = 1, is_active = true;

INSERT INTO product_categories (name, sort_order, is_active) VALUES
  ('Фото на паспорт', 2, true)
ON CONFLICT (name) DO UPDATE SET sort_order = 2, is_active = true;

INSERT INTO product_categories (name, sort_order, is_active) VALUES
  ('Фото на загран', 3, true)
ON CONFLICT (name) DO UPDATE SET sort_order = 3, is_active = true;

INSERT INTO product_categories (name, sort_order, is_active) VALUES
  ('Ретушь Базовая', 4, true)
ON CONFLICT (name) DO UPDATE SET sort_order = 4, is_active = true;

INSERT INTO product_categories (name, sort_order, is_active) VALUES
  ('Фото на другие документы', 5, true)
ON CONFLICT (name) DO UPDATE SET sort_order = 5, is_active = true;

-- Ряд 2 (sort 6-10)
INSERT INTO product_categories (name, sort_order, is_active) VALUES
  ('Срочные фото на документы', 6, true)
ON CONFLICT (name) DO UPDATE SET sort_order = 6, is_active = true;

INSERT INTO product_categories (name, sort_order, is_active) VALUES
  ('Печать', 7, true)
ON CONFLICT (name) DO UPDATE SET sort_order = 7, is_active = true;

INSERT INTO product_categories (name, sort_order, is_active) VALUES
  ('Студийная фотосъёмка', 8, true)
ON CONFLICT (name) DO UPDATE SET sort_order = 8, is_active = true;

INSERT INTO product_categories (name, sort_order, is_active) VALUES
  ('Ретушь Профессиональная', 9, true)
ON CONFLICT (name) DO UPDATE SET sort_order = 9, is_active = true;

-- "Фоторамки" уже переименована выше, обновляем sort_order
UPDATE product_categories SET sort_order = 10, is_active = true WHERE name = 'Фоторамки';

-- Ряд 3 (sort 11-15)
INSERT INTO product_categories (name, sort_order, is_active) VALUES
  ('Фото на Грин-Карту', 11, true)
ON CONFLICT (name) DO UPDATE SET sort_order = 11, is_active = true;

INSERT INTO product_categories (name, sort_order, is_active) VALUES
  ('Студентам', 12, true)
ON CONFLICT (name) DO UPDATE SET sort_order = 12, is_active = true;

INSERT INTO product_categories (name, sort_order, is_active) VALUES
  ('Чертежи', 13, true)
ON CONFLICT (name) DO UPDATE SET sort_order = 13, is_active = true;

INSERT INTO product_categories (name, sort_order, is_active) VALUES
  ('Ретушь Премиальная', 14, true)
ON CONFLICT (name) DO UPDATE SET sort_order = 14, is_active = true;

INSERT INTO product_categories (name, sort_order, is_active) VALUES
  ('Визитки/карточка', 15, true)
ON CONFLICT (name) DO UPDATE SET sort_order = 15, is_active = true;

-- Ряд 4 (sort 16-20)
INSERT INTO product_categories (name, sort_order, is_active) VALUES
  ('Дизайн', 16, true)
ON CONFLICT (name) DO UPDATE SET sort_order = 16, is_active = true;

INSERT INTO product_categories (name, sort_order, is_active) VALUES
  ('Индивидуальный заказ', 17, true)
ON CONFLICT (name) DO UPDATE SET sort_order = 17, is_active = true;

INSERT INTO product_categories (name, sort_order, is_active) VALUES
  ('Портфолио', 18, true)
ON CONFLICT (name) DO UPDATE SET sort_order = 18, is_active = true;

-- "Сувениры и реставрация" уже переименована выше, обновляем sort_order
UPDATE product_categories SET sort_order = 19, is_active = true WHERE name = 'Сувениры и реставрация';

-- Ряд 5 (sort 21)
INSERT INTO product_categories (name, sort_order, is_active) VALUES
  ('Услуги', 21, true)
ON CONFLICT (name) DO UPDATE SET sort_order = 21, is_active = true;

-- =============================================================
-- 3. Сдвигаем оставшиеся материальные категории вниз (sort 100+)
--    Они не в целевом макете, но удалять нельзя (привязаны товары)
-- =============================================================

UPDATE product_categories SET sort_order = 101 WHERE name = 'Фотобумага';
UPDATE product_categories SET sort_order = 102 WHERE name = 'Обычная бумага';
UPDATE product_categories SET sort_order = 103 WHERE name = 'Чернила и тонеры';

COMMIT;
