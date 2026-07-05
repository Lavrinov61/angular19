-- All Lite plans → 199₽ entry price
-- Applied: 2026-03-27
BEGIN;
UPDATE subscription_plans SET base_price = 199.00, updated_at = now()
WHERE slug IN ('launch-docs-lite', 'launch-photoprint-lite', 'launch-printscan-lite', 'launch-retouch-lite', 'launch-scan-lite');

DELETE FROM subscription_plan_items WHERE plan_id IN (SELECT id FROM subscription_plans WHERE slug IN ('launch-docs-lite','launch-photoprint-lite','launch-printscan-lite','launch-retouch-lite','launch-scan-lite'));

-- Docs Lite: 1 bundle
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, sort_order)
SELECT sp.id, p.id, 1, 1 FROM subscription_plans sp, products p WHERE sp.slug='launch-docs-lite' AND p.name='На все документы (4 комплекта)';

-- Photo-print Lite: 15 × 10x15
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, sort_order)
SELECT sp.id, '81476759-8e40-4d50-a15b-556f3f8a3368', 15, 1 FROM subscription_plans sp WHERE sp.slug='launch-photoprint-lite';

-- Print+Scan Lite: 30 B&W + 5 color + 20 scans
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, sort_order)
SELECT sp.id, p.id, 30, 1 FROM subscription_plans sp, products p WHERE sp.slug='launch-printscan-lite' AND p.name='Печать A4 ч/б';
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, sort_order)
SELECT sp.id, p.id, 5, 2 FROM subscription_plans sp, products p WHERE sp.slug='launch-printscan-lite' AND p.name='Печать A4 цвет';
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, sort_order)
SELECT sp.id, p.id, 20, 3 FROM subscription_plans sp, products p WHERE sp.slug='launch-printscan-lite' AND p.name='Авто-скан документа';

-- Retouch Lite: 1 reportage
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, sort_order)
SELECT sp.id, p.id, 1, 1 FROM subscription_plans sp, products p WHERE sp.slug='launch-retouch-lite' AND p.name='Ретушь репортажная';

-- Scan Lite: 50 auto + 3 manual
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, sort_order)
SELECT sp.id, p.id, 50, 1 FROM subscription_plans sp, products p WHERE sp.slug='launch-scan-lite' AND p.name='Авто-скан документа';
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, sort_order)
SELECT sp.id, p.id, 3, 2 FROM subscription_plans sp, products p WHERE sp.slug='launch-scan-lite' AND p.name='Ручное сканирование';

UPDATE subscription_plans SET description='1 комплект фото на документы (4 шт) каждый месяц.' WHERE slug='launch-docs-lite';
UPDATE subscription_plans SET description='15 фото 10×15 каждый месяц.' WHERE slug='launch-photoprint-lite';
UPDATE subscription_plans SET description='30 стр ч/б + 5 цвет + 20 сканов.' WHERE slug='launch-printscan-lite';
UPDATE subscription_plans SET description='1 репортажная ретушь каждый месяц.' WHERE slug='launch-retouch-lite';
UPDATE subscription_plans SET description='50 авто-сканов + 3 ручных.' WHERE slug='launch-scan-lite';
COMMIT;
