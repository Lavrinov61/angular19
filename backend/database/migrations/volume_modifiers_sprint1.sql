-- Volume modifiers: competitive pricing update (Sprint 1)
-- Маркетолог: конкурентный анализ 6 компаний Ростова
-- Новые множители: x0.90 (50+), x0.80 (100+), x0.70 (300+)
-- Было: x0.80/x0.70/x0.50 — слишком агрессивные скидки
-- Idempotent: uses ON CONFLICT DO UPDATE

BEGIN;

-- Ensure idempotency: unique index on (name, service_option_id) for option-level modifiers
CREATE UNIQUE INDEX IF NOT EXISTS uq_price_modifiers_name_option
  ON price_modifiers (name, service_option_id)
  WHERE service_option_id IS NOT NULL;

-- ============================================================
-- 0. UPDATE EXISTING A4 VOLUME MODIFIERS (old x0.80/x0.70/x0.50 → x0.90/x0.80/x0.70)
-- ============================================================
UPDATE price_modifiers
SET modifier_value = 0.90, updated_at = NOW()
WHERE modifier_type = 'volume' AND modifier_value = 0.80
  AND conditions::text LIKE '%"min_qty": 50%';

UPDATE price_modifiers
SET modifier_value = 0.80, updated_at = NOW()
WHERE modifier_type = 'volume' AND modifier_value = 0.70
  AND conditions::text LIKE '%"min_qty": 100%';

UPDATE price_modifiers
SET modifier_value = 0.70, updated_at = NOW()
WHERE modifier_type = 'volume' AND modifier_value = 0.50
  AND conditions::text LIKE '%"min_qty": 300%';

-- ============================================================
-- 1. PHOTO PRINTING 10x15 (premium + super)
-- ============================================================

-- 10x15 premium (19.50₽ base)
INSERT INTO price_modifiers (name, modifier_type, scope, service_option_id, modifier_action, modifier_value, conditions, priority, is_active)
VALUES
  ('Фото 10x15 премиум 50-99шт',  'volume', 'option', 'b4e04d67-08ea-4c02-aaf3-1e9e813a5e99', 'multiply', 0.90, '{"min_qty": 50, "max_qty": 99}',  10, true),
  ('Фото 10x15 премиум 100-299шт', 'volume', 'option', 'b4e04d67-08ea-4c02-aaf3-1e9e813a5e99', 'multiply', 0.80, '{"min_qty": 100, "max_qty": 299}', 20, true),
  ('Фото 10x15 премиум 300+шт',    'volume', 'option', 'b4e04d67-08ea-4c02-aaf3-1e9e813a5e99', 'multiply', 0.70, '{"min_qty": 300}',                 30, true)
ON CONFLICT (name, service_option_id) WHERE service_option_id IS NOT NULL
DO UPDATE SET modifier_value = EXCLUDED.modifier_value, conditions = EXCLUDED.conditions, updated_at = NOW();

-- 10x15 super (36.00₽ base)
INSERT INTO price_modifiers (name, modifier_type, scope, service_option_id, modifier_action, modifier_value, conditions, priority, is_active)
VALUES
  ('Фото 10x15 супер 50-99шт',  'volume', 'option', '74249997-6b1e-4c0e-a3f6-d2e199662192', 'multiply', 0.90, '{"min_qty": 50, "max_qty": 99}',  10, true),
  ('Фото 10x15 супер 100-299шт', 'volume', 'option', '74249997-6b1e-4c0e-a3f6-d2e199662192', 'multiply', 0.80, '{"min_qty": 100, "max_qty": 299}', 20, true),
  ('Фото 10x15 супер 300+шт',    'volume', 'option', '74249997-6b1e-4c0e-a3f6-d2e199662192', 'multiply', 0.70, '{"min_qty": 300}',                 30, true)
ON CONFLICT (name, service_option_id) WHERE service_option_id IS NOT NULL
DO UPDATE SET modifier_value = EXCLUDED.modifier_value, conditions = EXCLUDED.conditions, updated_at = NOW();

-- ============================================================
-- 2. PHOTO PRINTING 15x20 (premium + super)
-- ============================================================

-- 15x20 premium (49.00₽ base)
INSERT INTO price_modifiers (name, modifier_type, scope, service_option_id, modifier_action, modifier_value, conditions, priority, is_active)
VALUES
  ('Фото 15x20 премиум 50-99шт',  'volume', 'option', '5dfc82d0-d7b5-4c7f-b275-9e5fab0a53f0', 'multiply', 0.90, '{"min_qty": 50, "max_qty": 99}',  10, true),
  ('Фото 15x20 премиум 100-299шт', 'volume', 'option', '5dfc82d0-d7b5-4c7f-b275-9e5fab0a53f0', 'multiply', 0.80, '{"min_qty": 100, "max_qty": 299}', 20, true),
  ('Фото 15x20 премиум 300+шт',    'volume', 'option', '5dfc82d0-d7b5-4c7f-b275-9e5fab0a53f0', 'multiply', 0.70, '{"min_qty": 300}',                 30, true)
ON CONFLICT (name, service_option_id) WHERE service_option_id IS NOT NULL
DO UPDATE SET modifier_value = EXCLUDED.modifier_value, conditions = EXCLUDED.conditions, updated_at = NOW();

-- 15x20 super (70.00₽ base)
INSERT INTO price_modifiers (name, modifier_type, scope, service_option_id, modifier_action, modifier_value, conditions, priority, is_active)
VALUES
  ('Фото 15x20 супер 50-99шт',  'volume', 'option', '0c8e19e4-030d-4362-a6db-fb1fdf8e798c', 'multiply', 0.90, '{"min_qty": 50, "max_qty": 99}',  10, true),
  ('Фото 15x20 супер 100-299шт', 'volume', 'option', '0c8e19e4-030d-4362-a6db-fb1fdf8e798c', 'multiply', 0.80, '{"min_qty": 100, "max_qty": 299}', 20, true),
  ('Фото 15x20 супер 300+шт',    'volume', 'option', '0c8e19e4-030d-4362-a6db-fb1fdf8e798c', 'multiply', 0.70, '{"min_qty": 300}',                 30, true)
ON CONFLICT (name, service_option_id) WHERE service_option_id IS NOT NULL
DO UPDATE SET modifier_value = EXCLUDED.modifier_value, conditions = EXCLUDED.conditions, updated_at = NOW();

-- ============================================================
-- 3. PHOTO PRINTING 20x30 (premium + super)
-- ============================================================

-- 20x30 premium (117.00₽ base)
INSERT INTO price_modifiers (name, modifier_type, scope, service_option_id, modifier_action, modifier_value, conditions, priority, is_active)
VALUES
  ('Фото 20x30 премиум 50-99шт',  'volume', 'option', 'be242acf-f4f7-425c-b3f6-6f22352342df', 'multiply', 0.90, '{"min_qty": 50, "max_qty": 99}',  10, true),
  ('Фото 20x30 премиум 100-299шт', 'volume', 'option', 'be242acf-f4f7-425c-b3f6-6f22352342df', 'multiply', 0.80, '{"min_qty": 100, "max_qty": 299}', 20, true),
  ('Фото 20x30 премиум 300+шт',    'volume', 'option', 'be242acf-f4f7-425c-b3f6-6f22352342df', 'multiply', 0.70, '{"min_qty": 300}',                 30, true)
ON CONFLICT (name, service_option_id) WHERE service_option_id IS NOT NULL
DO UPDATE SET modifier_value = EXCLUDED.modifier_value, conditions = EXCLUDED.conditions, updated_at = NOW();

-- 20x30 super (140.00₽ base)
INSERT INTO price_modifiers (name, modifier_type, scope, service_option_id, modifier_action, modifier_value, conditions, priority, is_active)
VALUES
  ('Фото 20x30 супер 50-99шт',  'volume', 'option', 'c84a9a74-8aeb-4af1-9c78-f1ee70d42b98', 'multiply', 0.90, '{"min_qty": 50, "max_qty": 99}',  10, true),
  ('Фото 20x30 супер 100-299шт', 'volume', 'option', 'c84a9a74-8aeb-4af1-9c78-f1ee70d42b98', 'multiply', 0.80, '{"min_qty": 100, "max_qty": 299}', 20, true),
  ('Фото 20x30 супер 300+шт',    'volume', 'option', 'c84a9a74-8aeb-4af1-9c78-f1ee70d42b98', 'multiply', 0.70, '{"min_qty": 300}',                 30, true)
ON CONFLICT (name, service_option_id) WHERE service_option_id IS NOT NULL
DO UPDATE SET modifier_value = EXCLUDED.modifier_value, conditions = EXCLUDED.conditions, updated_at = NOW();

-- ============================================================
-- 4. A3 COPIES (bw, color, photo-color)
-- ============================================================

-- A3 bw copy (17₽ base)
INSERT INTO price_modifiers (name, modifier_type, scope, service_option_id, modifier_action, modifier_value, conditions, priority, is_active)
VALUES
  ('A3 ксерокопия ч/б 50-99шт',  'volume', 'option', '825f214f-42c9-447d-8813-d6a6f03f230e', 'multiply', 0.90, '{"min_qty": 50, "max_qty": 99}',  10, true),
  ('A3 ксерокопия ч/б 100-299шт', 'volume', 'option', '825f214f-42c9-447d-8813-d6a6f03f230e', 'multiply', 0.80, '{"min_qty": 100, "max_qty": 299}', 20, true),
  ('A3 ксерокопия ч/б 300+шт',    'volume', 'option', '825f214f-42c9-447d-8813-d6a6f03f230e', 'multiply', 0.70, '{"min_qty": 300}',                 30, true)
ON CONFLICT (name, service_option_id) WHERE service_option_id IS NOT NULL
DO UPDATE SET modifier_value = EXCLUDED.modifier_value, conditions = EXCLUDED.conditions, updated_at = NOW();

-- A3 color copy (30₽ base)
INSERT INTO price_modifiers (name, modifier_type, scope, service_option_id, modifier_action, modifier_value, conditions, priority, is_active)
VALUES
  ('A3 ксерокопия цвет 50-99шт',  'volume', 'option', 'e2888ae3-1683-425a-a37c-db79ad57f2c6', 'multiply', 0.90, '{"min_qty": 50, "max_qty": 99}',  10, true),
  ('A3 ксерокопия цвет 100-299шт', 'volume', 'option', 'e2888ae3-1683-425a-a37c-db79ad57f2c6', 'multiply', 0.80, '{"min_qty": 100, "max_qty": 299}', 20, true),
  ('A3 ксерокопия цвет 300+шт',    'volume', 'option', 'e2888ae3-1683-425a-a37c-db79ad57f2c6', 'multiply', 0.70, '{"min_qty": 300}',                 30, true)
ON CONFLICT (name, service_option_id) WHERE service_option_id IS NOT NULL
DO UPDATE SET modifier_value = EXCLUDED.modifier_value, conditions = EXCLUDED.conditions, updated_at = NOW();

-- A3 photo-color copy (60₽ base)
INSERT INTO price_modifiers (name, modifier_type, scope, service_option_id, modifier_action, modifier_value, conditions, priority, is_active)
VALUES
  ('A3 ксерокопия фото-цвет 50-99шт',  'volume', 'option', '379bbc2a-a23e-40ed-9b0d-bc1d48848f59', 'multiply', 0.90, '{"min_qty": 50, "max_qty": 99}',  10, true),
  ('A3 ксерокопия фото-цвет 100-299шт', 'volume', 'option', '379bbc2a-a23e-40ed-9b0d-bc1d48848f59', 'multiply', 0.80, '{"min_qty": 100, "max_qty": 299}', 20, true),
  ('A3 ксерокопия фото-цвет 300+шт',    'volume', 'option', '379bbc2a-a23e-40ed-9b0d-bc1d48848f59', 'multiply', 0.70, '{"min_qty": 300}',                 30, true)
ON CONFLICT (name, service_option_id) WHERE service_option_id IS NOT NULL
DO UPDATE SET modifier_value = EXCLUDED.modifier_value, conditions = EXCLUDED.conditions, updated_at = NOW();

-- ============================================================
-- 5. A3 PRINTING (bw, color)
-- ============================================================

-- A3 bw print (17₽ base)
INSERT INTO price_modifiers (name, modifier_type, scope, service_option_id, modifier_action, modifier_value, conditions, priority, is_active)
VALUES
  ('A3 печать ч/б 50-99шт',  'volume', 'option', '13fd62da-99de-4af7-8a31-f578fd5212a3', 'multiply', 0.90, '{"min_qty": 50, "max_qty": 99}',  10, true),
  ('A3 печать ч/б 100-299шт', 'volume', 'option', '13fd62da-99de-4af7-8a31-f578fd5212a3', 'multiply', 0.80, '{"min_qty": 100, "max_qty": 299}', 20, true),
  ('A3 печать ч/б 300+шт',    'volume', 'option', '13fd62da-99de-4af7-8a31-f578fd5212a3', 'multiply', 0.70, '{"min_qty": 300}',                 30, true)
ON CONFLICT (name, service_option_id) WHERE service_option_id IS NOT NULL
DO UPDATE SET modifier_value = EXCLUDED.modifier_value, conditions = EXCLUDED.conditions, updated_at = NOW();

-- A3 color print (17₽ base)
INSERT INTO price_modifiers (name, modifier_type, scope, service_option_id, modifier_action, modifier_value, conditions, priority, is_active)
VALUES
  ('A3 печать цвет 50-99шт',  'volume', 'option', '0d1c5aea-2424-417a-996e-32748550cdf7', 'multiply', 0.90, '{"min_qty": 50, "max_qty": 99}',  10, true),
  ('A3 печать цвет 100-299шт', 'volume', 'option', '0d1c5aea-2424-417a-996e-32748550cdf7', 'multiply', 0.80, '{"min_qty": 100, "max_qty": 299}', 20, true),
  ('A3 печать цвет 300+шт',    'volume', 'option', '0d1c5aea-2424-417a-996e-32748550cdf7', 'multiply', 0.70, '{"min_qty": 300}',                 30, true)
ON CONFLICT (name, service_option_id) WHERE service_option_id IS NOT NULL
DO UPDATE SET modifier_value = EXCLUDED.modifier_value, conditions = EXCLUDED.conditions, updated_at = NOW();

-- ============================================================
-- 6. SCANNING (auto-feed + manual)
-- ============================================================

-- Auto-feed scanning (5₽ base)
INSERT INTO price_modifiers (name, modifier_type, scope, service_option_id, modifier_action, modifier_value, conditions, priority, is_active)
VALUES
  ('Сканирование авто 50-99шт',  'volume', 'option', 'f29246f9-b5dc-4ec7-b829-2570138ba567', 'multiply', 0.90, '{"min_qty": 50, "max_qty": 99}',  10, true),
  ('Сканирование авто 100-299шт', 'volume', 'option', 'f29246f9-b5dc-4ec7-b829-2570138ba567', 'multiply', 0.80, '{"min_qty": 100, "max_qty": 299}', 20, true),
  ('Сканирование авто 300+шт',    'volume', 'option', 'f29246f9-b5dc-4ec7-b829-2570138ba567', 'multiply', 0.70, '{"min_qty": 300}',                 30, true)
ON CONFLICT (name, service_option_id) WHERE service_option_id IS NOT NULL
DO UPDATE SET modifier_value = EXCLUDED.modifier_value, conditions = EXCLUDED.conditions, updated_at = NOW();

-- Manual scanning (50₽ base)
INSERT INTO price_modifiers (name, modifier_type, scope, service_option_id, modifier_action, modifier_value, conditions, priority, is_active)
VALUES
  ('Сканирование ручное 50-99шт',  'volume', 'option', '6d946018-c8b8-456c-a412-8dfff63fe962', 'multiply', 0.90, '{"min_qty": 50, "max_qty": 99}',  10, true),
  ('Сканирование ручное 100-299шт', 'volume', 'option', '6d946018-c8b8-456c-a412-8dfff63fe962', 'multiply', 0.80, '{"min_qty": 100, "max_qty": 299}', 20, true),
  ('Сканирование ручное 300+шт',    'volume', 'option', '6d946018-c8b8-456c-a412-8dfff63fe962', 'multiply', 0.70, '{"min_qty": 300}',                 30, true)
ON CONFLICT (name, service_option_id) WHERE service_option_id IS NOT NULL
DO UPDATE SET modifier_value = EXCLUDED.modifier_value, conditions = EXCLUDED.conditions, updated_at = NOW();

-- ============================================================
-- 7. BLUEPRINTS / DRAWINGS A3 (bw + color)
-- ============================================================

-- A3 bw drawing (10₽ base)
INSERT INTO price_modifiers (name, modifier_type, scope, service_option_id, modifier_action, modifier_value, conditions, priority, is_active)
VALUES
  ('Чертёж A3 ч/б 50-99шт',  'volume', 'option', 'a061662f-3483-4402-b750-222cbb19e9d6', 'multiply', 0.90, '{"min_qty": 50, "max_qty": 99}',  10, true),
  ('Чертёж A3 ч/б 100-299шт', 'volume', 'option', 'a061662f-3483-4402-b750-222cbb19e9d6', 'multiply', 0.80, '{"min_qty": 100, "max_qty": 299}', 20, true),
  ('Чертёж A3 ч/б 300+шт',    'volume', 'option', 'a061662f-3483-4402-b750-222cbb19e9d6', 'multiply', 0.70, '{"min_qty": 300}',                 30, true)
ON CONFLICT (name, service_option_id) WHERE service_option_id IS NOT NULL
DO UPDATE SET modifier_value = EXCLUDED.modifier_value, conditions = EXCLUDED.conditions, updated_at = NOW();

-- A3 color drawing (17₽ base)
INSERT INTO price_modifiers (name, modifier_type, scope, service_option_id, modifier_action, modifier_value, conditions, priority, is_active)
VALUES
  ('Чертёж A3 цвет 50-99шт',  'volume', 'option', '20f912e8-508b-44fb-b1d9-745048f6029a', 'multiply', 0.90, '{"min_qty": 50, "max_qty": 99}',  10, true),
  ('Чертёж A3 цвет 100-299шт', 'volume', 'option', '20f912e8-508b-44fb-b1d9-745048f6029a', 'multiply', 0.80, '{"min_qty": 100, "max_qty": 299}', 20, true),
  ('Чертёж A3 цвет 300+шт',    'volume', 'option', '20f912e8-508b-44fb-b1d9-745048f6029a', 'multiply', 0.70, '{"min_qty": 300}',                 30, true)
ON CONFLICT (name, service_option_id) WHERE service_option_id IS NOT NULL
DO UPDATE SET modifier_value = EXCLUDED.modifier_value, conditions = EXCLUDED.conditions, updated_at = NOW();

COMMIT;
