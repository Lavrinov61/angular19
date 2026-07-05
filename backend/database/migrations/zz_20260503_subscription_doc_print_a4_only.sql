-- Keep only A4 document-print subscriptions for the gradual subscription launch.
-- Applied after earlier subscription lineup migrations.

BEGIN;

UPDATE subscription_plans
SET is_active = false,
    is_popular = false,
    is_recommended = false,
    updated_at = now()
WHERE slug NOT IN ('doc-print-student', 'doc-print-business', 'doc-print-office')
  AND (
    is_active IS DISTINCT FROM false
    OR is_popular IS DISTINCT FROM false
    OR is_recommended IS DISTINCT FROM false
  );

UPDATE subscription_plans
SET category = 'doc-print',
    icon = 'print',
    billing_period = 'monthly',
    credits_rollover_months = 3,
    is_customizable = false,
    is_active = true,
    updated_at = now()
WHERE slug IN ('doc-print-student', 'doc-print-business', 'doc-print-office');

UPDATE subscription_plans
SET name = 'Студент',
    description = '50 страниц A4 ч/б каждый месяц',
    base_price = 199.00,
    subscriber_discount_percent = 15.00,
    sort_order = 10,
    is_popular = false,
    is_recommended = false,
    features = '["50 страниц A4 ч/б в месяц", "Скидка 15% сверх лимита", "Перенос на 3 месяца"]'::jsonb,
    savings_label = 'Экономия 34%',
    updated_at = now()
WHERE slug = 'doc-print-student';

UPDATE subscription_plans
SET name = 'Бизнес',
    description = '250 страниц A4 ч/б каждый месяц',
    base_price = 999.00,
    subscriber_discount_percent = 20.00,
    sort_order = 20,
    is_popular = true,
    is_recommended = true,
    features = '["250 страниц A4 ч/б в месяц", "Скидка 20% сверх лимита", "Перенос на 3 месяца"]'::jsonb,
    savings_label = 'Экономия 33%',
    updated_at = now()
WHERE slug = 'doc-print-business';

UPDATE subscription_plans
SET name = 'Офис',
    description = '800 страниц A4 ч/б каждый месяц',
    base_price = 2490.00,
    subscriber_discount_percent = 30.00,
    sort_order = 30,
    is_popular = false,
    is_recommended = false,
    features = '["800 страниц A4 ч/б в месяц", "Скидка 30% сверх лимита", "Перенос на 3 месяца"]'::jsonb,
    savings_label = 'Экономия 48%',
    updated_at = now()
WHERE slug = 'doc-print-office';

DELETE FROM subscription_plan_items
WHERE plan_id IN (
  SELECT id
  FROM subscription_plans
  WHERE slug IN ('doc-print-student', 'doc-print-business', 'doc-print-office')
);

INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, is_required, sort_order)
SELECT sp.id, 'a2000001-0000-0000-0000-000000000001', 50, true, 10
FROM subscription_plans sp
WHERE sp.slug = 'doc-print-student';

INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, is_required, sort_order)
SELECT sp.id, 'a2000001-0000-0000-0000-000000000001', 250, true, 10
FROM subscription_plans sp
WHERE sp.slug = 'doc-print-business';

INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, is_required, sort_order)
SELECT sp.id, 'a2000001-0000-0000-0000-000000000001', 800, true, 10
FROM subscription_plans sp
WHERE sp.slug = 'doc-print-office';

COMMIT;
