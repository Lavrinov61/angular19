-- Subscription Plan Items: заполнение состава планов
-- Идемпотентно: ON CONFLICT DO NOTHING

-- ═══════════════════════════════════════════════════════
-- PRINT планы: student / business / office
-- ═══════════════════════════════════════════════════════

-- print-student: 199₽/мес
-- 200 стр. А4 ч/б (0.50₽) + 20 стр. А4 цветная (2₽)
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, credit_price, is_required, sort_order)
SELECT sp.id, p.id, 200, 0.42, false, 0
FROM subscription_plans sp, products p
WHERE sp.slug = 'print-student' AND p.name = 'Бумага A4 80g офисная'
ON CONFLICT DO NOTHING;

INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, credit_price, is_required, sort_order)
SELECT sp.id, p.id, 20, 1.70, false, 1
FROM subscription_plans sp, products p
WHERE sp.slug = 'print-student' AND p.name = 'Бумага A4 матовая 120g'
ON CONFLICT DO NOTHING;

-- print-business: 899₽/мес
-- 1000 стр. А4 ч/б + 100 стр. А4 цветная + 50 стр. А3
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, credit_price, is_required, sort_order)
SELECT sp.id, p.id, 1000, 0.40, false, 0
FROM subscription_plans sp, products p
WHERE sp.slug = 'print-business' AND p.name = 'Бумага A4 80g офисная'
ON CONFLICT DO NOTHING;

INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, credit_price, is_required, sort_order)
SELECT sp.id, p.id, 100, 1.60, false, 1
FROM subscription_plans sp, products p
WHERE sp.slug = 'print-business' AND p.name = 'Бумага A4 матовая 120g'
ON CONFLICT DO NOTHING;

INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, credit_price, is_required, sort_order)
SELECT sp.id, p.id, 50, 0.85, false, 2
FROM subscription_plans sp, products p
WHERE sp.slug = 'print-business' AND p.name = 'Бумага A3 80g офисная'
ON CONFLICT DO NOTHING;

-- print-office: 2490₽/мес
-- 3000 стр. А4 ч/б + 300 стр. А4 цветная + 200 стр. А3 + 50 стр. глянцевая
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, credit_price, is_required, sort_order)
SELECT sp.id, p.id, 3000, 0.38, false, 0
FROM subscription_plans sp, products p
WHERE sp.slug = 'print-office' AND p.name = 'Бумага A4 80g офисная'
ON CONFLICT DO NOTHING;

INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, credit_price, is_required, sort_order)
SELECT sp.id, p.id, 300, 1.50, false, 1
FROM subscription_plans sp, products p
WHERE sp.slug = 'print-office' AND p.name = 'Бумага A4 матовая 120g'
ON CONFLICT DO NOTHING;

INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, credit_price, is_required, sort_order)
SELECT sp.id, p.id, 200, 0.80, false, 2
FROM subscription_plans sp, products p
WHERE sp.slug = 'print-office' AND p.name = 'Бумага A3 80g офисная'
ON CONFLICT DO NOTHING;

INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, credit_price, is_required, sort_order)
SELECT sp.id, p.id, 50, 2.50, false, 3
FROM subscription_plans sp, products p
WHERE sp.slug = 'print-office' AND p.name = 'Бумага A4 глянцевая 150g'
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════
-- PHOTO-PRINT планы: fan / family / photographer
-- ═══════════════════════════════════════════════════════

-- photoprint-fan: 249₽/мес
-- 30 фото 10x15 Premium + 5 фото 15x21
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, credit_price, is_required, sort_order)
SELECT sp.id, p.id, 30, 4.25, false, 0
FROM subscription_plans sp, products p
WHERE sp.slug = 'photoprint-fan' AND p.name = 'Фотобумага 10x15 Premium'
ON CONFLICT DO NOTHING;

INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, credit_price, is_required, sort_order)
SELECT sp.id, p.id, 5, 10.00, false, 1
FROM subscription_plans sp, products p
WHERE sp.slug = 'photoprint-fan' AND p.name = 'Фотобумага 15x21 Premium'
ON CONFLICT DO NOTHING;

-- photoprint-family: 599₽/мес
-- 80 фото 10x15 + 15 фото 15x21 + 5 фото 21x30
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, credit_price, is_required, sort_order)
SELECT sp.id, p.id, 80, 4.00, false, 0
FROM subscription_plans sp, products p
WHERE sp.slug = 'photoprint-family' AND p.name = 'Фотобумага 10x15 Premium'
ON CONFLICT DO NOTHING;

INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, credit_price, is_required, sort_order)
SELECT sp.id, p.id, 15, 9.50, false, 1
FROM subscription_plans sp, products p
WHERE sp.slug = 'photoprint-family' AND p.name = 'Фотобумага 15x21 Premium'
ON CONFLICT DO NOTHING;

INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, credit_price, is_required, sort_order)
SELECT sp.id, p.id, 5, 20.00, false, 2
FROM subscription_plans sp, products p
WHERE sp.slug = 'photoprint-family' AND p.name = 'Фотобумага 21x30 (A4) Premium'
ON CONFLICT DO NOTHING;

-- photoprint-photographer: 1290₽/мес
-- 200 фото 10x15 + 40 фото 15x21 + 15 фото 21x30 + 5 фото 30x40
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, credit_price, is_required, sort_order)
SELECT sp.id, p.id, 200, 3.50, false, 0
FROM subscription_plans sp, products p
WHERE sp.slug = 'photoprint-photographer' AND p.name = 'Фотобумага 10x15 Premium'
ON CONFLICT DO NOTHING;

INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, credit_price, is_required, sort_order)
SELECT sp.id, p.id, 40, 8.50, false, 1
FROM subscription_plans sp, products p
WHERE sp.slug = 'photoprint-photographer' AND p.name = 'Фотобумага 15x21 Premium'
ON CONFLICT DO NOTHING;

INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, credit_price, is_required, sort_order)
SELECT sp.id, p.id, 15, 18.00, false, 2
FROM subscription_plans sp, products p
WHERE sp.slug = 'photoprint-photographer' AND p.name = 'Фотобумага 21x30 (A4) Premium'
ON CONFLICT DO NOTHING;

INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, credit_price, is_required, sort_order)
SELECT sp.id, p.id, 5, 48.00, false, 3
FROM subscription_plans sp, products p
WHERE sp.slug = 'photoprint-photographer' AND p.name = 'Фотобумага 30x40 Premium'
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════
-- PHOTO-DOCS планы: agent / agency / corporate
-- ═══════════════════════════════════════════════════════

-- docs-agent: 1990₽/мес
-- 5 комплектов "На все документы" + 3 "Подстановка формы" + 2 "Нейро стандарт"
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, credit_price, is_required, sort_order)
SELECT sp.id, p.id, 5, 250.00, false, 0
FROM subscription_plans sp, products p
WHERE sp.slug = 'docs-agent' AND p.code = 'all-docs-bundle'
ON CONFLICT DO NOTHING;

INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, credit_price, is_required, sort_order)
SELECT sp.id, p.id, 3, 130.00, false, 1
FROM subscription_plans sp, products p
WHERE sp.slug = 'docs-agent' AND p.code = 'uniform'
ON CONFLICT DO NOTHING;

INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, credit_price, is_required, sort_order)
SELECT sp.id, p.id, 2, 800.00, false, 2
FROM subscription_plans sp, products p
WHERE sp.slug = 'docs-agent' AND p.code = 'neuro-standard'
ON CONFLICT DO NOTHING;

-- docs-agency: 5990₽/мес
-- 20 комплектов "На все документы" + 10 "Подстановка формы" + 5 "Нейро стандарт" + 2 "Нейро полный"
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, credit_price, is_required, sort_order)
SELECT sp.id, p.id, 20, 200.00, false, 0
FROM subscription_plans sp, products p
WHERE sp.slug = 'docs-agency' AND p.code = 'all-docs-bundle'
ON CONFLICT DO NOTHING;

INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, credit_price, is_required, sort_order)
SELECT sp.id, p.id, 10, 110.00, false, 1
FROM subscription_plans sp, products p
WHERE sp.slug = 'docs-agency' AND p.code = 'uniform'
ON CONFLICT DO NOTHING;

INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, credit_price, is_required, sort_order)
SELECT sp.id, p.id, 5, 700.00, false, 2
FROM subscription_plans sp, products p
WHERE sp.slug = 'docs-agency' AND p.code = 'neuro-standard'
ON CONFLICT DO NOTHING;

INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, credit_price, is_required, sort_order)
SELECT sp.id, p.id, 2, 2400.00, false, 3
FROM subscription_plans sp, products p
WHERE sp.slug = 'docs-agency' AND p.code = 'neuro-full'
ON CONFLICT DO NOTHING;

-- docs-corporate: 12900₽/мес
-- 50 комплектов "На все документы" + 30 "Подстановка формы" + 10 "Нейро стандарт" + 5 "Нейро полный" + 3 "Срочная"
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, credit_price, is_required, sort_order)
SELECT sp.id, p.id, 50, 170.00, false, 0
FROM subscription_plans sp, products p
WHERE sp.slug = 'docs-corporate' AND p.code = 'all-docs-bundle'
ON CONFLICT DO NOTHING;

INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, credit_price, is_required, sort_order)
SELECT sp.id, p.id, 30, 95.00, false, 1
FROM subscription_plans sp, products p
WHERE sp.slug = 'docs-corporate' AND p.code = 'uniform'
ON CONFLICT DO NOTHING;

INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, credit_price, is_required, sort_order)
SELECT sp.id, p.id, 10, 600.00, false, 2
FROM subscription_plans sp, products p
WHERE sp.slug = 'docs-corporate' AND p.code = 'neuro-standard'
ON CONFLICT DO NOTHING;

INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, credit_price, is_required, sort_order)
SELECT sp.id, p.id, 5, 2200.00, false, 3
FROM subscription_plans sp, products p
WHERE sp.slug = 'docs-corporate' AND p.code = 'neuro-full'
ON CONFLICT DO NOTHING;

INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, credit_price, is_required, sort_order)
SELECT sp.id, p.id, 3, 130.00, false, 4
FROM subscription_plans sp, products p
WHERE sp.slug = 'docs-corporate' AND p.code = 'urgent'
ON CONFLICT DO NOTHING;
