-- Sprint 5: Convert photo-print subscriptions from discount-based to credit-based
-- Same model as doc-print, scan, retouch, photo-docs — included quantities
-- Idempotent: safe to re-run

BEGIN;

-- 1. Enable subscription eligibility for photo print products
UPDATE products SET is_subscription_eligible = true, subscription_credit_value = 1
WHERE id IN (
  '81476759-8e40-4d50-a15b-556f3f8a3368', -- Фотобумага 10x15 Premium (sell=19.50, cost=7.04, margin=64%)
  '361b90ff-aca3-492a-a3f1-5f380e1f229e', -- Фотобумага 10x15 Super (sell=36, cost=10.80, margin=70%)
  '66848433-f5e8-4aaa-ae00-fe0705ad2f31', -- Фотобумага 15x21 Premium (sell=49, cost=14, margin=71%)
  'a1c22a22-41bf-418f-a5d9-e40dc84a0faa', -- Фотобумага 15x21 Super (sell=70, cost=20, margin=71%)
  '9d710edb-0cfd-4419-8aed-f6b59986bc1b', -- Фотобумага 21x30 (A4) Premium (sell=117, cost=30.10, margin=74%)
  '488b7160-589e-4ea3-984f-ab84e9e9659e'  -- Фотобумага 21x30 (A4) Super (sell=140, cost=47, margin=66%)
);

-- 2. Remove old discount-based plan_items (if any)
DELETE FROM subscription_plan_items
WHERE plan_id IN (
  SELECT id FROM subscription_plans WHERE category = 'photo-print' AND is_active = true
);

-- 3. Reset subscriber_discount_percent to 10% (beyond-limit discount, same as other categories)
UPDATE subscription_plans
SET subscriber_discount_percent = 10
WHERE slug = 'photoprint-fan';

UPDATE subscription_plans
SET subscriber_discount_percent = 15
WHERE slug = 'photoprint-family';

UPDATE subscription_plans
SET subscriber_discount_percent = 20
WHERE slug = 'photoprint-photographer';

-- 4. Insert credit-based plan items
--
-- Любитель 299₽/мес: 15 × 10x15 Premium
--   Cost: 15 × 7.04 = 105.60₽ (35% of plan price)
--   Retail value: 15 × 19.50 = 292.50₽
--   Margin: 65%
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity)
SELECT sp.id, '81476759-8e40-4d50-a15b-556f3f8a3368', 15
FROM subscription_plans sp WHERE sp.slug = 'photoprint-fan'
ON CONFLICT DO NOTHING;

-- Семейный 699₽/мес: 25 × 10x15 Premium + 5 × 15x21 Premium
--   Cost: 25 × 7.04 + 5 × 14 = 176 + 70 = 246₽ (35% of plan price)
--   Retail value: 25 × 19.50 + 5 × 49 = 487.50 + 245 = 732.50₽
--   Margin: 65%
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity)
SELECT sp.id, '81476759-8e40-4d50-a15b-556f3f8a3368', 25
FROM subscription_plans sp WHERE sp.slug = 'photoprint-family'
ON CONFLICT DO NOTHING;

INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity)
SELECT sp.id, '66848433-f5e8-4aaa-ae00-fe0705ad2f31', 5
FROM subscription_plans sp WHERE sp.slug = 'photoprint-family'
ON CONFLICT DO NOTHING;

-- Фотограф 1490₽/мес: 50 × 10x15 Premium + 10 × 15x21 Premium + 3 × 21x30 Premium
--   Cost: 50 × 7.04 + 10 × 14 + 3 × 30.10 = 352 + 140 + 90.30 = 582.30₽ (39% of plan price)
--   Retail value: 50 × 19.50 + 10 × 49 + 3 × 117 = 975 + 490 + 351 = 1816₽
--   Margin: 61%
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity)
SELECT sp.id, '81476759-8e40-4d50-a15b-556f3f8a3368', 50
FROM subscription_plans sp WHERE sp.slug = 'photoprint-photographer'
ON CONFLICT DO NOTHING;

INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity)
SELECT sp.id, '66848433-f5e8-4aaa-ae00-fe0705ad2f31', 10
FROM subscription_plans sp WHERE sp.slug = 'photoprint-photographer'
ON CONFLICT DO NOTHING;

INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity)
SELECT sp.id, '9d710edb-0cfd-4419-8aed-f6b59986bc1b', 3
FROM subscription_plans sp WHERE sp.slug = 'photoprint-photographer'
ON CONFLICT DO NOTHING;

-- 5. Update descriptions to reflect included quantities
UPDATE subscription_plans SET
  description = '15 фото 10×15 каждый месяц. Печатайте семейные фото и снимки из путешествий. Неиспользованное переносится на 3 мес.',
  savings_label = 'Экономия до 50%'
WHERE slug = 'photoprint-fan';

UPDATE subscription_plans SET
  description = '25 фото 10×15 + 5 фото 15×21 каждый месяц. Для семей, которые ценят домашний фотоархив. Самый популярный выбор.',
  savings_label = 'Экономия до 50%'
WHERE slug = 'photoprint-family';

UPDATE subscription_plans SET
  description = '50 фото 10×15 + 10 фото 15×21 + 3 фото 21×30 каждый месяц. Для профессиональных фотографов. Максимальный объём.',
  savings_label = 'Экономия до 55%'
WHERE slug = 'photoprint-photographer';

COMMIT;
