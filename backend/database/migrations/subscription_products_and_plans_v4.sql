-- ============================================================================
-- Migration: subscription_products_and_plans_v4.sql
-- Date: 2026-03-26
-- Purpose: Fix paper prices, create printing service products, redesign plans
-- Idempotent: YES (all operations use ON CONFLICT / WHERE clauses)
-- ============================================================================

BEGIN;

-- ============================================================================
-- PART 1: Fix paper cost_price / sell_price
-- ============================================================================

-- A4 80g офисная: cost was 0.30 (understated), real = 0.62; sell 0.50 → 1.00
UPDATE products SET cost_price = 0.62, sell_price = 1.00, updated_at = now()
WHERE id = '71b5eabc-f00a-434a-a0fe-9db001a79bbb';

-- A3 80g офисная: cost was 0.60 (understated), real = 2.80; sell 1.00 → 4.00
UPDATE products SET cost_price = 2.80, sell_price = 4.00, updated_at = now()
WHERE id = '95801867-e56d-4d4c-96c4-08ee9b14d3aa';

-- A4 матовая 120g: cost 1.00, sell 2.00 — keep as-is (photo paper, correct)
-- A4 глянцевая 150g: cost 1.50, sell 3.00 — keep as-is (photo paper, correct)

-- ============================================================================
-- PART 2: Create printing service products
-- ============================================================================

-- Use deterministic UUIDs for idempotency (a2000001-... namespace)
INSERT INTO products (id, name, sell_price, cost_price, category_id, product_type, unit, is_subscription_eligible, is_active, sort_order)
VALUES
  ('a2000001-0000-0000-0000-000000000001', 'Печать A4 ч/б',   6.00,  2.25, '9b309418-f8c0-4584-bf9b-f066a6698b89', 'service', 'piece', true, true, 10),
  ('a2000001-0000-0000-0000-000000000002', 'Печать A4 цвет', 15.00,  2.78, '9b309418-f8c0-4584-bf9b-f066a6698b89', 'service', 'piece', true, true, 20),
  ('a2000001-0000-0000-0000-000000000003', 'Печать A3 ч/б',  12.00,  4.42, '9b309418-f8c0-4584-bf9b-f066a6698b89', 'service', 'piece', true, true, 30),
  ('a2000001-0000-0000-0000-000000000004', 'Печать A3 цвет', 25.00,  4.95, '9b309418-f8c0-4584-bf9b-f066a6698b89', 'service', 'piece', true, true, 40)
ON CONFLICT (id) DO UPDATE SET
  sell_price = EXCLUDED.sell_price,
  cost_price = EXCLUDED.cost_price,
  name = EXCLUDED.name,
  is_subscription_eligible = EXCLUDED.is_subscription_eligible,
  updated_at = now();

-- ============================================================================
-- PART 3: Update scan/lamination product prices
-- ============================================================================

-- Авто-скан документа: sell 5 OK, add cost_price 1.54
UPDATE products SET cost_price = 1.54, updated_at = now()
WHERE id = 'a1000001-0000-0000-0000-000000000001';

-- Ручное сканирование: sell 20 → 15, cost_price = 4.94
UPDATE products SET sell_price = 15.00, cost_price = 4.94, updated_at = now()
WHERE id = 'a1000001-0000-0000-0000-000000000002';

-- Кадрирование скана: sell 15 → 20, cost_price = 9.70
UPDATE products SET sell_price = 20.00, cost_price = 9.70, updated_at = now()
WHERE id = 'a1000001-0000-0000-0000-000000000003';

-- Плёнка для ламинации → Ламинирование A4: sell 0 → 15, cost 6.25
UPDATE products SET
  name = 'Ламинирование A4',
  sell_price = 15.00,
  cost_price = 6.25,
  category_id = '9b309418-f8c0-4584-bf9b-f066a6698b89',
  is_subscription_eligible = true,
  updated_at = now()
WHERE id = '25ad33fd-04cd-4aa4-88f5-051341f50632';

-- ============================================================================
-- PART 4: Update subscription plan prices
-- ============================================================================

-- doc-print-student: 199 → 249
UPDATE subscription_plans SET base_price = 249.00, updated_at = now()
WHERE id = '95f12334-fa11-49a8-8f41-2b1cfc53eb74';

-- doc-print-business: 899 → 999
UPDATE subscription_plans SET base_price = 999.00, updated_at = now()
WHERE id = 'a1049434-a6c8-4379-866e-c1433a9c51a7';

-- doc-print-office: 2490 stays the same — no change needed

-- ============================================================================
-- PART 5: Rebuild subscription_plan_items for doc-print plans
-- Replace paper products with printing SERVICE products
-- ============================================================================

-- Delete old doc-print items (paper-based)
DELETE FROM subscription_plan_items
WHERE plan_id IN (
  '95f12334-fa11-49a8-8f41-2b1cfc53eb74',  -- doc-print-student
  'a1049434-a6c8-4379-866e-c1433a9c51a7',  -- doc-print-business
  '58444fd3-4f55-4d85-b442-c4c3dc8bb5e9'   -- doc-print-office
);

-- doc-print-student (249₽/мес): 50 A4 ч/б (300₽) + 5 A4 цвет (75₽) = 375₽ retail → 34% savings
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, is_required, sort_order) VALUES
  ('95f12334-fa11-49a8-8f41-2b1cfc53eb74', 'a2000001-0000-0000-0000-000000000001', 50, true, 10),   -- 50× Печать A4 ч/б
  ('95f12334-fa11-49a8-8f41-2b1cfc53eb74', 'a2000001-0000-0000-0000-000000000002',  5, true, 20);   -- 5× Печать A4 цвет

-- doc-print-business (999₽/мес): 200 A4 ч/б (1200₽) + 20 A4 цвет (300₽) + 10 A3 ч/б (120₽) = 1620₽ → 38% savings
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, is_required, sort_order) VALUES
  ('a1049434-a6c8-4379-866e-c1433a9c51a7', 'a2000001-0000-0000-0000-000000000001', 200, true, 10),  -- 200× Печать A4 ч/б
  ('a1049434-a6c8-4379-866e-c1433a9c51a7', 'a2000001-0000-0000-0000-000000000002',  20, true, 20),  -- 20× Печать A4 цвет
  ('a1049434-a6c8-4379-866e-c1433a9c51a7', 'a2000001-0000-0000-0000-000000000003',  10, true, 30);  -- 10× Печать A3 ч/б

-- doc-print-office (2490₽/мес): 500 A4 ч/б (3000₽) + 50 A4 цвет (750₽) + 20 A3 ч/б (240₽) = 3990₽ → 38% savings
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, is_required, sort_order) VALUES
  ('58444fd3-4f55-4d85-b442-c4c3dc8bb5e9', 'a2000001-0000-0000-0000-000000000001', 500, true, 10),  -- 500× Печать A4 ч/б
  ('58444fd3-4f55-4d85-b442-c4c3dc8bb5e9', 'a2000001-0000-0000-0000-000000000002',  50, true, 20),  -- 50× Печать A4 цвет
  ('58444fd3-4f55-4d85-b442-c4c3dc8bb5e9', 'a2000001-0000-0000-0000-000000000003',  20, true, 30);  -- 20× Печать A3 ч/б

-- ============================================================================
-- PART 6: Rebuild photo-print plan items (increase quantities for value)
-- ============================================================================

DELETE FROM subscription_plan_items
WHERE plan_id IN (
  '7a8ed52f-4a1e-4c94-a94d-19ed95e747bd',  -- photo-print-fan
  '351a5219-d46c-4c6a-8c95-dfb8a01de4f3',  -- photo-print-family
  '450d1dbd-d5f4-466b-99f8-869166888f82'   -- photo-print-pro
);

-- photo-print-fan "Любитель" (249₽): 50×10x15 (250₽) + 10×15x21 (120₽) = 370₽ → 33% savings
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, is_required, sort_order) VALUES
  ('7a8ed52f-4a1e-4c94-a94d-19ed95e747bd', '81476759-8e40-4d50-a15b-556f3f8a3368', 50, true, 10),  -- 50× Фотобумага 10x15
  ('7a8ed52f-4a1e-4c94-a94d-19ed95e747bd', '66848433-f5e8-4aaa-ae00-fe0705ad2f31', 10, true, 20);  -- 10× Фотобумага 15x21

-- photo-print-family "Семейный" (599₽): 100×10x15 (500₽) + 20×15x21 (240₽) + 5×21x30 (125₽) = 865₽ → 31% savings
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, is_required, sort_order) VALUES
  ('351a5219-d46c-4c6a-8c95-dfb8a01de4f3', '81476759-8e40-4d50-a15b-556f3f8a3368', 100, true, 10), -- 100× Фотобумага 10x15
  ('351a5219-d46c-4c6a-8c95-dfb8a01de4f3', '66848433-f5e8-4aaa-ae00-fe0705ad2f31',  20, true, 20), -- 20× Фотобумага 15x21
  ('351a5219-d46c-4c6a-8c95-dfb8a01de4f3', '9d710edb-0cfd-4419-8aed-f6b59986bc1b',   5, true, 30); -- 5× Фотобумага 21x30

-- photo-print-pro "Фотограф" (1290₽): 200×10x15 (1000₽) + 40×15x21 (480₽) + 10×21x30 (250₽) + 5×30x40 (300₽) = 2030₽ → 36% savings
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, is_required, sort_order) VALUES
  ('450d1dbd-d5f4-466b-99f8-869166888f82', '81476759-8e40-4d50-a15b-556f3f8a3368', 200, true, 10), -- 200× Фотобумага 10x15
  ('450d1dbd-d5f4-466b-99f8-869166888f82', '66848433-f5e8-4aaa-ae00-fe0705ad2f31',  40, true, 20), -- 40× Фотобумага 15x21
  ('450d1dbd-d5f4-466b-99f8-869166888f82', '9d710edb-0cfd-4419-8aed-f6b59986bc1b',  10, true, 30), -- 10× Фотобумага 21x30
  ('450d1dbd-d5f4-466b-99f8-869166888f82', '80b3d641-d2ce-475a-a74c-8003f05f1eca',   5, true, 40); -- 5× Фотобумага 30x40

-- ============================================================================
-- PART 7: Rebuild scan plan items (with updated product prices)
-- ============================================================================

DELETE FROM subscription_plan_items
WHERE plan_id IN (
  'fed161b3-d471-466d-bdcf-fff44a6dd063',  -- scan-lite
  '6de4af08-0fc0-4234-a94c-b6774269871d',  -- scan-pro
  '12cd58d3-5971-4219-8b6a-715ee922bf21'   -- scan-biz
);

-- scan-lite "Архив Лайт" (299₽): 100 авто-скан (500₽) + 5 ручных (75₽) = 575₽ → 48% savings
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, is_required, sort_order) VALUES
  ('fed161b3-d471-466d-bdcf-fff44a6dd063', 'a1000001-0000-0000-0000-000000000001', 100, true, 10),  -- 100× Авто-скан
  ('fed161b3-d471-466d-bdcf-fff44a6dd063', 'a1000001-0000-0000-0000-000000000002',   5, true, 20);  -- 5× Ручное сканирование

-- scan-pro "Архив Про" (799₽): 300 авто (1500₽) + 20 ручных (300₽) + 10 кадриров (200₽) = 2000₽ → 60% savings
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, is_required, sort_order) VALUES
  ('6de4af08-0fc0-4234-a94c-b6774269871d', 'a1000001-0000-0000-0000-000000000001', 300, true, 10),  -- 300× Авто-скан
  ('6de4af08-0fc0-4234-a94c-b6774269871d', 'a1000001-0000-0000-0000-000000000002',  20, true, 20),  -- 20× Ручное сканирование
  ('6de4af08-0fc0-4234-a94c-b6774269871d', 'a1000001-0000-0000-0000-000000000003',  10, true, 30);  -- 10× Кадрирование скана

-- scan-biz "Архив Бизнес" (1990₽): 500 авто (2500₽) + 30 ручных (450₽) + 20 кадриров (400₽) + 10 ламинир (150₽) = 3500₽ → 43% savings
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, is_required, sort_order) VALUES
  ('12cd58d3-5971-4219-8b6a-715ee922bf21', 'a1000001-0000-0000-0000-000000000001', 500, true, 10),  -- 500× Авто-скан
  ('12cd58d3-5971-4219-8b6a-715ee922bf21', 'a1000001-0000-0000-0000-000000000002',  30, true, 20),  -- 30× Ручное сканирование
  ('12cd58d3-5971-4219-8b6a-715ee922bf21', 'a1000001-0000-0000-0000-000000000003',  20, true, 30),  -- 20× Кадрирование скана
  ('12cd58d3-5971-4219-8b6a-715ee922bf21', '25ad33fd-04cd-4aa4-88f5-051341f50632',  10, true, 40);  -- 10× Ламинирование A4

COMMIT;
