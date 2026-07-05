-- POS Enterprise Seed: consumable products, stock, rules, commission rules
-- Idempotent: all INSERTs use ON CONFLICT DO NOTHING

BEGIN;

-- ============================================================
-- 1. PRODUCTS — расходные материалы (product_type = 'product')
-- ============================================================

-- NB: UNIQUE(name, category_id) with NULL category_id does not prevent
-- duplicate NULLs in standard btree, so use WHERE NOT EXISTS.

INSERT INTO products (name, product_type, unit, sell_price, category_id)
SELECT 'Чернила CMYK (мл)', 'product', 'liter', 0, NULL
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name = 'Чернила CMYK (мл)' AND category_id IS NULL);

INSERT INTO products (name, product_type, unit, sell_price, category_id)
SELECT 'Тонер ч/б (гр)', 'product', 'kg', 0, NULL
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name = 'Тонер ч/б (гр)' AND category_id IS NULL);

INSERT INTO products (name, product_type, unit, sell_price, category_id)
SELECT 'Плёнка для ламинации', 'product', 'piece', 0, NULL
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name = 'Плёнка для ламинации' AND category_id IS NULL);

INSERT INTO products (name, product_type, unit, sell_price, category_id)
SELECT 'Уголки для фото', 'product', 'piece', 0, NULL
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name = 'Уголки для фото' AND category_id IS NULL);

-- ============================================================
-- 2. PRODUCT_STOCK — остатки для студии Соборный
-- ============================================================

-- Studio: Своё Фото — Соборный = 30ef357f-06a6-4b01-b1ff-dbbe7eaed446

-- Фотобумага 10x15 Premium (id: 81476759-8e40-4d50-a15b-556f3f8a3368)
INSERT INTO product_stock (product_id, studio_id, quantity, min_quantity)
VALUES ('81476759-8e40-4d50-a15b-556f3f8a3368', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', 500, 50)
ON CONFLICT (product_id, studio_id) DO NOTHING;

-- Фотобумага 10x15 Super (id: 361b90ff-aca3-492a-a3f1-5f380e1f229e)
INSERT INTO product_stock (product_id, studio_id, quantity, min_quantity)
VALUES ('361b90ff-aca3-492a-a3f1-5f380e1f229e', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', 200, 30)
ON CONFLICT (product_id, studio_id) DO NOTHING;

-- Бумага A4 80g офисная (id: 71b5eabc-f00a-434a-a0fe-9db001a79bbb)
INSERT INTO product_stock (product_id, studio_id, quantity, min_quantity)
VALUES ('71b5eabc-f00a-434a-a0fe-9db001a79bbb', '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', 300, 30)
ON CONFLICT (product_id, studio_id) DO NOTHING;

-- Чернила CMYK (мл) — id через подзапрос
INSERT INTO product_stock (product_id, studio_id, quantity, min_quantity)
SELECT p.id, '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', 500, 100
FROM products p WHERE p.name = 'Чернила CMYK (мл)' AND p.category_id IS NULL
ON CONFLICT (product_id, studio_id) DO NOTHING;

-- Тонер ч/б (гр)
INSERT INTO product_stock (product_id, studio_id, quantity, min_quantity)
SELECT p.id, '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', 200, 50
FROM products p WHERE p.name = 'Тонер ч/б (гр)' AND p.category_id IS NULL
ON CONFLICT (product_id, studio_id) DO NOTHING;

-- Плёнка для ламинации
INSERT INTO product_stock (product_id, studio_id, quantity, min_quantity)
SELECT p.id, '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', 100, 20
FROM products p WHERE p.name = 'Плёнка для ламинации' AND p.category_id IS NULL
ON CONFLICT (product_id, studio_id) DO NOTHING;

-- Уголки для фото
INSERT INTO product_stock (product_id, studio_id, quantity, min_quantity)
SELECT p.id, '30ef357f-06a6-4b01-b1ff-dbbe7eaed446', 500, 50
FROM products p WHERE p.name = 'Уголки для фото' AND p.category_id IS NULL
ON CONFLICT (product_id, studio_id) DO NOTHING;

-- ============================================================
-- 3. CONSUMABLE_RULES — привязка услуг к расходникам
-- ============================================================

-- Экспресс (basic, a788f458) → Фотобумага 10x15 Premium ×4 листов
INSERT INTO consumable_rules (service_option_id, product_stock_id, quantity_per_unit, unit_label)
SELECT 'a788f458-3b32-4b52-860e-4fe4a8213283'::uuid, ps.id, 4, 'листов'
FROM product_stock ps
WHERE ps.product_id = '81476759-8e40-4d50-a15b-556f3f8a3368'
  AND ps.studio_id = '30ef357f-06a6-4b01-b1ff-dbbe7eaed446'
ON CONFLICT (service_option_id, product_stock_id) DO NOTHING;

-- Экспресс → Чернила CMYK ×2 мл
INSERT INTO consumable_rules (service_option_id, product_stock_id, quantity_per_unit, unit_label)
SELECT 'a788f458-3b32-4b52-860e-4fe4a8213283'::uuid, ps.id, 2, 'мл'
FROM product_stock ps JOIN products p ON ps.product_id = p.id
WHERE p.name = 'Чернила CMYK (мл)' AND ps.studio_id = '30ef357f-06a6-4b01-b1ff-dbbe7eaed446'
ON CONFLICT (service_option_id, product_stock_id) DO NOTHING;

-- Профессиональный (retouch, e69d76bb) → Фотобумага 10x15 Premium ×6
INSERT INTO consumable_rules (service_option_id, product_stock_id, quantity_per_unit, unit_label)
SELECT 'e69d76bb-1143-4e29-ad6c-fc79f0a551af'::uuid, ps.id, 6, 'листов'
FROM product_stock ps
WHERE ps.product_id = '81476759-8e40-4d50-a15b-556f3f8a3368'
  AND ps.studio_id = '30ef357f-06a6-4b01-b1ff-dbbe7eaed446'
ON CONFLICT (service_option_id, product_stock_id) DO NOTHING;

-- Профессиональный → Чернила CMYK ×3 мл
INSERT INTO consumable_rules (service_option_id, product_stock_id, quantity_per_unit, unit_label)
SELECT 'e69d76bb-1143-4e29-ad6c-fc79f0a551af'::uuid, ps.id, 3, 'мл'
FROM product_stock ps JOIN products p ON ps.product_id = p.id
WHERE p.name = 'Чернила CMYK (мл)' AND ps.studio_id = '30ef357f-06a6-4b01-b1ff-dbbe7eaed446'
ON CONFLICT (service_option_id, product_stock_id) DO NOTHING;

-- Премиум (vip, 994f9dfe) → Фотобумага 10x15 Premium ×8
INSERT INTO consumable_rules (service_option_id, product_stock_id, quantity_per_unit, unit_label)
SELECT '994f9dfe-ca2d-4fcf-80c2-ecc4d7ae0898'::uuid, ps.id, 8, 'листов'
FROM product_stock ps
WHERE ps.product_id = '81476759-8e40-4d50-a15b-556f3f8a3368'
  AND ps.studio_id = '30ef357f-06a6-4b01-b1ff-dbbe7eaed446'
ON CONFLICT (service_option_id, product_stock_id) DO NOTHING;

-- Премиум → Чернила CMYK ×4 мл
INSERT INTO consumable_rules (service_option_id, product_stock_id, quantity_per_unit, unit_label)
SELECT '994f9dfe-ca2d-4fcf-80c2-ecc4d7ae0898'::uuid, ps.id, 4, 'мл'
FROM product_stock ps JOIN products p ON ps.product_id = p.id
WHERE p.name = 'Чернила CMYK (мл)' AND ps.studio_id = '30ef357f-06a6-4b01-b1ff-dbbe7eaed446'
ON CONFLICT (service_option_id, product_stock_id) DO NOTHING;

-- Ксерокопия А4 ч/б (copy-a4-bw, 2c1eb1a4) → Бумага A4 ×1
INSERT INTO consumable_rules (service_option_id, product_stock_id, quantity_per_unit, unit_label)
SELECT '2c1eb1a4-e8f1-4b0d-91eb-02cb96f7410a'::uuid, ps.id, 1, 'листов'
FROM product_stock ps
WHERE ps.product_id = '71b5eabc-f00a-434a-a0fe-9db001a79bbb'
  AND ps.studio_id = '30ef357f-06a6-4b01-b1ff-dbbe7eaed446'
ON CONFLICT (service_option_id, product_stock_id) DO NOTHING;

-- Ксерокопия А4 ч/б → Тонер ×1 гр
INSERT INTO consumable_rules (service_option_id, product_stock_id, quantity_per_unit, unit_label)
SELECT '2c1eb1a4-e8f1-4b0d-91eb-02cb96f7410a'::uuid, ps.id, 1, 'гр'
FROM product_stock ps JOIN products p ON ps.product_id = p.id
WHERE p.name = 'Тонер ч/б (гр)' AND ps.studio_id = '30ef357f-06a6-4b01-b1ff-dbbe7eaed446'
ON CONFLICT (service_option_id, product_stock_id) DO NOTHING;

-- Ксерокопия А4 цветная (copy-a4-color, 217a396c) → Бумага A4 ×1
INSERT INTO consumable_rules (service_option_id, product_stock_id, quantity_per_unit, unit_label)
SELECT '217a396c-c2b0-42ab-9c06-f87604b29567'::uuid, ps.id, 1, 'листов'
FROM product_stock ps
WHERE ps.product_id = '71b5eabc-f00a-434a-a0fe-9db001a79bbb'
  AND ps.studio_id = '30ef357f-06a6-4b01-b1ff-dbbe7eaed446'
ON CONFLICT (service_option_id, product_stock_id) DO NOTHING;

-- Ксерокопия А4 цветная → Чернила CMYK ×3 мл
INSERT INTO consumable_rules (service_option_id, product_stock_id, quantity_per_unit, unit_label)
SELECT '217a396c-c2b0-42ab-9c06-f87604b29567'::uuid, ps.id, 3, 'мл'
FROM product_stock ps JOIN products p ON ps.product_id = p.id
WHERE p.name = 'Чернила CMYK (мл)' AND ps.studio_id = '30ef357f-06a6-4b01-b1ff-dbbe7eaed446'
ON CONFLICT (service_option_id, product_stock_id) DO NOTHING;

-- Ламинирование (lamination, 7611c8e9) → Плёнка ×1
INSERT INTO consumable_rules (service_option_id, product_stock_id, quantity_per_unit, unit_label)
SELECT '7611c8e9-437f-4fbb-b29b-68076dce52c1'::uuid, ps.id, 1, 'шт'
FROM product_stock ps JOIN products p ON ps.product_id = p.id
WHERE p.name = 'Плёнка для ламинации' AND ps.studio_id = '30ef357f-06a6-4b01-b1ff-dbbe7eaed446'
ON CONFLICT (service_option_id, product_stock_id) DO NOTHING;

-- ============================================================
-- 4. EMPLOYEE_COMMISSION_RULES — глобальные ставки
-- NB: UNIQUE(employee_id, role, category_slug) does not prevent
-- duplicate NULLs in standard btree, so use WHERE NOT EXISTS.
-- ============================================================

-- Global default: 5% от чека, priority 0
INSERT INTO employee_commission_rules (employee_id, role, category_slug, rate, min_receipt_total, priority)
SELECT NULL, NULL, NULL, 0.0500, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM employee_commission_rules
  WHERE employee_id IS NULL AND role IS NULL AND category_slug IS NULL
);

-- Фото на документы: 10%, priority 10
INSERT INTO employee_commission_rules (employee_id, role, category_slug, rate, min_receipt_total, priority)
SELECT NULL, NULL, 'photo-docs', 0.1000, 0, 10
WHERE NOT EXISTS (
  SELECT 1 FROM employee_commission_rules
  WHERE employee_id IS NULL AND role IS NULL AND category_slug = 'photo-docs'
);

-- Нейрофото: 8%, priority 10
INSERT INTO employee_commission_rules (employee_id, role, category_slug, rate, min_receipt_total, priority)
SELECT NULL, NULL, 'neurophoto', 0.0800, 0, 10
WHERE NOT EXISTS (
  SELECT 1 FROM employee_commission_rules
  WHERE employee_id IS NULL AND role IS NULL AND category_slug = 'neurophoto'
);

COMMIT;
