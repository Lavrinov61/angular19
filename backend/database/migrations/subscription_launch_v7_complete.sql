-- Sprint 5: Add retouch + photo-print subscription plans
-- Complete the launch lineup: ALL categories covered
-- Idempotent: ON CONFLICT DO UPDATE

BEGIN;

-- ============================================================================
-- RETOUCH PLANS (3 плана)
-- Простая ретушь (sell=50, cost≈75) УБЫТОЧНА — не делаем основой.
-- Базовая (sell=150, cost≈150), репортажная (sell=200, cost≈100),
-- профессиональная (sell=500, cost≈300) — маржа есть.
-- ============================================================================

-- Ретушь Лайт — 390₽/мес
-- 2 базовых (retail 300₽) + 1 репортажная (retail 200₽) = retail 500₽
-- Экономия: 500→390 = 22% (минимум, но базовая ретушь cost=150 → всё равно маржа)
-- Cost: 2*150 + 1*100 = 400₽, margin at 40% util = 390 - 400*0.4 = 230₽ (59%)
-- margin at 100% util = 390 - 400 = -10₽ → УВЕЛИЧИМ: 3 базовых + 1 репортажная = retail 650₽
-- Цена 449₽, экономия 31%, cost = 3*150+1*100 = 550, margin 100% = -101 → не годится
-- Проблема: cost ретуши ≈ sell. Нужно строить на репортажной/профессиональной.
--
-- Правильный план: 2 репортажных (retail 400, cost 200) + 1 базовая (retail 150, cost 150) = retail 550₽
-- Цена 390₽, экономия 29%, cost 350₽, margin 100% = 40₽ (10%), margin 40% = 250₽ (64%)
INSERT INTO subscription_plans (slug, name, description, base_price, category, icon, is_active, sort_order,
  features, billing_period, subscriber_discount_percent, credits_rollover_months, is_customizable,
  savings_label, is_popular, is_recommended)
VALUES (
  'launch-retouch-lite', 'Ретушь Лайт',
  '2 репортажных + 1 базовая ретушь каждый месяц. Для блогеров и контент-мейкеров.',
  390.00, 'retouch', 'auto_fix_high', true, 10,
  '[]'::jsonb, 'monthly', 5, 2, false,
  'Экономия до 30%', false, false
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description, base_price = EXCLUDED.base_price,
  category = EXCLUDED.category, icon = EXCLUDED.icon, is_active = true, sort_order = EXCLUDED.sort_order,
  features = EXCLUDED.features, subscriber_discount_percent = EXCLUDED.subscriber_discount_percent,
  credits_rollover_months = EXCLUDED.credits_rollover_months, savings_label = EXCLUDED.savings_label,
  is_popular = EXCLUDED.is_popular, is_recommended = EXCLUDED.is_recommended, updated_at = now();

-- Ретушь Стандарт — 990₽/мес ★
-- 5 репортажных (retail 1000, cost 500) + 2 базовых (retail 300, cost 300) + 1 профессиональная (retail 500, cost 300) = retail 1800₽
-- Экономия: 1800→990 = 45%, cost 1100₽, margin 40% = 990-440 = 550₽ (56%), margin 100% = -110₽
-- Опасно при 100%. Уберём 1 базовую: 5 репортажных + 1 базовая + 1 профессиональная = retail 1650₽
-- Экономия: 1650→990 = 40%, cost 950₽, margin 40% = 990-380 = 610₽ (62%), margin 100% = 40₽ (4%)
INSERT INTO subscription_plans (slug, name, description, base_price, category, icon, is_active, sort_order,
  features, billing_period, subscriber_discount_percent, credits_rollover_months, is_customizable,
  savings_label, is_popular, is_recommended)
VALUES (
  'launch-retouch-standard', 'Ретушь Стандарт',
  '5 репортажных + 1 базовая + 1 профессиональная ретушь каждый месяц. Для фотографов.',
  990.00, 'retouch', 'auto_fix_high', true, 20,
  '[]'::jsonb, 'monthly', 10, 3, false,
  'Экономия до 40%', true, true
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description, base_price = EXCLUDED.base_price,
  category = EXCLUDED.category, icon = EXCLUDED.icon, is_active = true, sort_order = EXCLUDED.sort_order,
  features = EXCLUDED.features, subscriber_discount_percent = EXCLUDED.subscriber_discount_percent,
  credits_rollover_months = EXCLUDED.credits_rollover_months, savings_label = EXCLUDED.savings_label,
  is_popular = EXCLUDED.is_popular, is_recommended = EXCLUDED.is_recommended, updated_at = now();

-- Ретушь Про — 2490₽/мес
-- 10 репортажных (retail 2000, cost 1000) + 3 базовых (retail 450, cost 450) + 2 профессиональных (retail 1000, cost 600) = retail 3450₽
-- Экономия: 3450→2490 = 28%, cost 2050₽, margin 40% = 2490-820 = 1670₽ (67%), margin 100% = 440₽ (18%)
INSERT INTO subscription_plans (slug, name, description, base_price, category, icon, is_active, sort_order,
  features, billing_period, subscriber_discount_percent, credits_rollover_months, is_customizable,
  savings_label, is_popular, is_recommended)
VALUES (
  'launch-retouch-pro', 'Ретушь Про',
  '10 репортажных + 3 базовых + 2 профессиональных ретуши. Для студий и агентств.',
  2490.00, 'retouch', 'auto_fix_high', true, 30,
  '[]'::jsonb, 'monthly', 15, 3, false,
  'Экономия до 28%', false, false
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description, base_price = EXCLUDED.base_price,
  category = EXCLUDED.category, icon = EXCLUDED.icon, is_active = true, sort_order = EXCLUDED.sort_order,
  features = EXCLUDED.features, subscriber_discount_percent = EXCLUDED.subscriber_discount_percent,
  credits_rollover_months = EXCLUDED.credits_rollover_months, savings_label = EXCLUDED.savings_label,
  is_popular = EXCLUDED.is_popular, is_recommended = EXCLUDED.is_recommended, updated_at = now();

-- ============================================================================
-- PHOTO-PRINT PLANS (3 плана)
-- Маржа 64-74% на фотобумаге — отличная база для подписок
-- 10x15 Premium: sell=19.50, cost=7.04 (64%)
-- 15x21 Premium: sell=49, cost=14 (71%)
-- 21x30 Premium: sell=117, cost=30.10 (74%)
-- ============================================================================

-- Фотопечать Лайт — 349₽/мес
-- 20 × 10x15 (retail 390, cost 140.80) + 3 × 15x21 (retail 147, cost 42) = retail 537₽
-- Экономия: 537→349 = 35%, cost 182.80₽, margin 40% = 349-73 = 276₽ (79%), margin 100% = 166₽ (48%)
INSERT INTO subscription_plans (slug, name, description, base_price, category, icon, is_active, sort_order,
  features, billing_period, subscriber_discount_percent, credits_rollover_months, is_customizable,
  savings_label, is_popular, is_recommended)
VALUES (
  'launch-photoprint-lite', 'Фотопечать Лайт',
  '20 фото 10×15 + 3 фото 15×21 каждый месяц. Для семейного фотоархива.',
  349.00, 'photo-print', 'photo', true, 10,
  '[]'::jsonb, 'monthly', 5, 2, false,
  'Экономия до 35%', false, false
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description, base_price = EXCLUDED.base_price,
  category = EXCLUDED.category, icon = EXCLUDED.icon, is_active = true, sort_order = EXCLUDED.sort_order,
  features = EXCLUDED.features, subscriber_discount_percent = EXCLUDED.subscriber_discount_percent,
  credits_rollover_months = EXCLUDED.credits_rollover_months, savings_label = EXCLUDED.savings_label,
  is_popular = EXCLUDED.is_popular, is_recommended = EXCLUDED.is_recommended, updated_at = now();

-- Фотопечать Стандарт — 690₽/мес ★
-- 40 × 10x15 (retail 780, cost 281.60) + 5 × 15x21 (retail 245, cost 70) + 2 × 21x30 (retail 234, cost 60.20) = retail 1259₽
-- Экономия: 1259→690 = 45%, cost 411.80₽, margin 40% = 690-165 = 525₽ (76%), margin 100% = 278₽ (40%)
INSERT INTO subscription_plans (slug, name, description, base_price, category, icon, is_active, sort_order,
  features, billing_period, subscriber_discount_percent, credits_rollover_months, is_customizable,
  savings_label, is_popular, is_recommended)
VALUES (
  'launch-photoprint-standard', 'Фотопечать Стандарт',
  '40 фото 10×15 + 5 фото 15×21 + 2 фото 21×30 каждый месяц. Самый популярный выбор.',
  690.00, 'photo-print', 'photo', true, 20,
  '[]'::jsonb, 'monthly', 10, 3, false,
  'Экономия до 45%', true, true
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description, base_price = EXCLUDED.base_price,
  category = EXCLUDED.category, icon = EXCLUDED.icon, is_active = true, sort_order = EXCLUDED.sort_order,
  features = EXCLUDED.features, subscriber_discount_percent = EXCLUDED.subscriber_discount_percent,
  credits_rollover_months = EXCLUDED.credits_rollover_months, savings_label = EXCLUDED.savings_label,
  is_popular = EXCLUDED.is_popular, is_recommended = EXCLUDED.is_recommended, updated_at = now();

-- Фотопечать Про — 1490₽/мес
-- 80 × 10x15 (retail 1560, cost 563.20) + 10 × 15x21 (retail 490, cost 140) + 5 × 21x30 (retail 585, cost 150.50) = retail 2635₽
-- Экономия: 2635→1490 = 43%, cost 853.70₽, margin 40% = 1490-341 = 1149₽ (77%), margin 100% = 636₽ (43%)
INSERT INTO subscription_plans (slug, name, description, base_price, category, icon, is_active, sort_order,
  features, billing_period, subscriber_discount_percent, credits_rollover_months, is_customizable,
  savings_label, is_popular, is_recommended)
VALUES (
  'launch-photoprint-pro', 'Фотопечать Про',
  '80 фото 10×15 + 10 фото 15×21 + 5 фото 21×30 каждый месяц. Для фотографов и студий.',
  1490.00, 'photo-print', 'photo', true, 30,
  '[]'::jsonb, 'monthly', 15, 3, false,
  'Экономия до 43%', false, false
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description, base_price = EXCLUDED.base_price,
  category = EXCLUDED.category, icon = EXCLUDED.icon, is_active = true, sort_order = EXCLUDED.sort_order,
  features = EXCLUDED.features, subscriber_discount_percent = EXCLUDED.subscriber_discount_percent,
  credits_rollover_months = EXCLUDED.credits_rollover_months, savings_label = EXCLUDED.savings_label,
  is_popular = EXCLUDED.is_popular, is_recommended = EXCLUDED.is_recommended, updated_at = now();

-- ============================================================================
-- SCAN PLANS — реактивация (scan-lite, scan-pro, scan-biz уже хорошие: 42-60% экономии)
-- Но они деактивированы v7. Создаём новые launch- планы.
-- ============================================================================

-- Скан Лайт — 249₽/мес
-- 80 авто-сканов (retail 400, cost 123.20) + 5 ручных (retail 75, cost 24.70) = retail 475₽
-- Экономия: 475→249 = 48%, cost 147.90₽, margin 40% = 249-59 = 190₽ (76%), margin 100% = 101₽ (41%)
INSERT INTO subscription_plans (slug, name, description, base_price, category, icon, is_active, sort_order,
  features, billing_period, subscriber_discount_percent, credits_rollover_months, is_customizable,
  savings_label, is_popular, is_recommended)
VALUES (
  'launch-scan-lite', 'Скан Лайт',
  '80 авто-сканов + 5 ручных сканирований. Для оцифровки архивов и документов.',
  249.00, 'scan', 'scanner', true, 10,
  '[]'::jsonb, 'monthly', 5, 2, false,
  'Экономия до 48%', true, false
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description, base_price = EXCLUDED.base_price,
  category = EXCLUDED.category, icon = EXCLUDED.icon, is_active = true, sort_order = EXCLUDED.sort_order,
  features = EXCLUDED.features, subscriber_discount_percent = EXCLUDED.subscriber_discount_percent,
  credits_rollover_months = EXCLUDED.credits_rollover_months, savings_label = EXCLUDED.savings_label,
  is_popular = EXCLUDED.is_popular, is_recommended = EXCLUDED.is_recommended, updated_at = now();

-- Скан Бизнес — 690₽/мес
-- 250 авто-сканов (retail 1250, cost 385) + 15 ручных (retail 225, cost 74.10) + 10 кадрирований (retail 200, cost 97) = retail 1675₽
-- Экономия: 1675→690 = 59%, cost 556.10₽, margin 40% = 690-222 = 468₽ (68%), margin 100% = 134₽ (19%)
INSERT INTO subscription_plans (slug, name, description, base_price, category, icon, is_active, sort_order,
  features, billing_period, subscriber_discount_percent, credits_rollover_months, is_customizable,
  savings_label, is_popular, is_recommended)
VALUES (
  'launch-scan-biz', 'Скан Бизнес',
  '250 авто-сканов + 15 ручных + 10 кадрирований. Для бизнеса и массовой оцифровки.',
  690.00, 'scan', 'scanner', true, 20,
  '[]'::jsonb, 'monthly', 10, 3, false,
  'Экономия до 59%', false, true
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description, base_price = EXCLUDED.base_price,
  category = EXCLUDED.category, icon = EXCLUDED.icon, is_active = true, sort_order = EXCLUDED.sort_order,
  features = EXCLUDED.features, subscriber_discount_percent = EXCLUDED.subscriber_discount_percent,
  credits_rollover_months = EXCLUDED.credits_rollover_months, savings_label = EXCLUDED.savings_label,
  is_popular = EXCLUDED.is_popular, is_recommended = EXCLUDED.is_recommended, updated_at = now();

-- ============================================================================
-- PLAN ITEMS — привязка продуктов к новым планам
-- ============================================================================

-- Сначала удалим старые items для наших планов (если re-run)
DELETE FROM subscription_plan_items WHERE plan_id IN (
  SELECT id FROM subscription_plans WHERE slug IN (
    'launch-retouch-lite', 'launch-retouch-standard', 'launch-retouch-pro',
    'launch-photoprint-lite', 'launch-photoprint-standard', 'launch-photoprint-pro',
    'launch-scan-lite', 'launch-scan-biz'
  )
);

-- RETOUCH items
-- Ретушь Лайт: 2 репортажных + 1 базовая
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, sort_order)
SELECT sp.id, p.id, 2, 1
FROM subscription_plans sp, products p
WHERE sp.slug = 'launch-retouch-lite' AND p.name = 'Ретушь репортажная';

INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, sort_order)
SELECT sp.id, p.id, 1, 2
FROM subscription_plans sp, products p
WHERE sp.slug = 'launch-retouch-lite' AND p.name = 'Ретушь базовая';

-- Ретушь Стандарт: 5 репортажных + 1 базовая + 1 профессиональная
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, sort_order)
SELECT sp.id, p.id, 5, 1
FROM subscription_plans sp, products p
WHERE sp.slug = 'launch-retouch-standard' AND p.name = 'Ретушь репортажная';

INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, sort_order)
SELECT sp.id, p.id, 1, 2
FROM subscription_plans sp, products p
WHERE sp.slug = 'launch-retouch-standard' AND p.name = 'Ретушь базовая';

INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, sort_order)
SELECT sp.id, p.id, 1, 3
FROM subscription_plans sp, products p
WHERE sp.slug = 'launch-retouch-standard' AND p.name = 'Ретушь профессиональная';

-- Ретушь Про: 10 репортажных + 3 базовых + 2 профессиональных
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, sort_order)
SELECT sp.id, p.id, 10, 1
FROM subscription_plans sp, products p
WHERE sp.slug = 'launch-retouch-pro' AND p.name = 'Ретушь репортажная';

INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, sort_order)
SELECT sp.id, p.id, 3, 2
FROM subscription_plans sp, products p
WHERE sp.slug = 'launch-retouch-pro' AND p.name = 'Ретушь базовая';

INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, sort_order)
SELECT sp.id, p.id, 2, 3
FROM subscription_plans sp, products p
WHERE sp.slug = 'launch-retouch-pro' AND p.name = 'Ретушь профессиональная';

-- PHOTO-PRINT items
-- Фотопечать Лайт: 20 × 10x15 + 3 × 15x21
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, sort_order)
SELECT sp.id, '81476759-8e40-4d50-a15b-556f3f8a3368', 20, 1
FROM subscription_plans sp WHERE sp.slug = 'launch-photoprint-lite';

INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, sort_order)
SELECT sp.id, '66848433-f5e8-4aaa-ae00-fe0705ad2f31', 3, 2
FROM subscription_plans sp WHERE sp.slug = 'launch-photoprint-lite';

-- Фотопечать Стандарт: 40 × 10x15 + 5 × 15x21 + 2 × 21x30
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, sort_order)
SELECT sp.id, '81476759-8e40-4d50-a15b-556f3f8a3368', 40, 1
FROM subscription_plans sp WHERE sp.slug = 'launch-photoprint-standard';

INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, sort_order)
SELECT sp.id, '66848433-f5e8-4aaa-ae00-fe0705ad2f31', 5, 2
FROM subscription_plans sp WHERE sp.slug = 'launch-photoprint-standard';

INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, sort_order)
SELECT sp.id, '9d710edb-0cfd-4419-8aed-f6b59986bc1b', 2, 3
FROM subscription_plans sp WHERE sp.slug = 'launch-photoprint-standard';

-- Фотопечать Про: 80 × 10x15 + 10 × 15x21 + 5 × 21x30
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, sort_order)
SELECT sp.id, '81476759-8e40-4d50-a15b-556f3f8a3368', 80, 1
FROM subscription_plans sp WHERE sp.slug = 'launch-photoprint-pro';

INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, sort_order)
SELECT sp.id, '66848433-f5e8-4aaa-ae00-fe0705ad2f31', 10, 2
FROM subscription_plans sp WHERE sp.slug = 'launch-photoprint-pro';

INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, sort_order)
SELECT sp.id, '9d710edb-0cfd-4419-8aed-f6b59986bc1b', 5, 3
FROM subscription_plans sp WHERE sp.slug = 'launch-photoprint-pro';

-- SCAN items
-- Скан Лайт: 80 авто-сканов + 5 ручных
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, sort_order)
SELECT sp.id, p.id, 80, 1
FROM subscription_plans sp, products p
WHERE sp.slug = 'launch-scan-lite' AND p.name = 'Авто-скан документа';

INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, sort_order)
SELECT sp.id, p.id, 5, 2
FROM subscription_plans sp, products p
WHERE sp.slug = 'launch-scan-lite' AND p.name = 'Ручное сканирование';

-- Скан Бизнес: 250 авто-сканов + 15 ручных + 10 кадрирований
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, sort_order)
SELECT sp.id, p.id, 250, 1
FROM subscription_plans sp, products p
WHERE sp.slug = 'launch-scan-biz' AND p.name = 'Авто-скан документа';

INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, sort_order)
SELECT sp.id, p.id, 15, 2
FROM subscription_plans sp, products p
WHERE sp.slug = 'launch-scan-biz' AND p.name = 'Ручное сканирование';

INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, sort_order)
SELECT sp.id, p.id, 10, 3
FROM subscription_plans sp, products p
WHERE sp.slug = 'launch-scan-biz' AND p.name = 'Кадрирование скана';

COMMIT;
