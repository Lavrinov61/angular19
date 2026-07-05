-- Restore the public subscription lineup to simple A4 document printing only.
-- This follows zz_20260503_subscription_doc_print_a4_only.sql, but creates the
-- doc-print rows if an environment missed the older broad subscription seed.

BEGIN;

INSERT INTO products (
  id, name, sell_price, cost_price, category_id, product_type, unit,
  is_subscription_eligible, is_active, sort_order
)
SELECT
  'a2000001-0000-0000-0000-000000000001',
  'Печать A4 ч/б',
  6.00,
  2.25,
  (SELECT id FROM product_categories WHERE name = 'Печать' LIMIT 1),
  'service',
  'piece',
  true,
  true,
  10
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  sell_price = EXCLUDED.sell_price,
  cost_price = EXCLUDED.cost_price,
  category_id = COALESCE(EXCLUDED.category_id, products.category_id),
  product_type = EXCLUDED.product_type,
  unit = EXCLUDED.unit,
  is_subscription_eligible = EXCLUDED.is_subscription_eligible,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

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

INSERT INTO subscription_plans (
  slug, name, description, base_price, is_customizable, min_price,
  billing_period, subscriber_discount_percent, credits_rollover_months,
  is_active, sort_order, features, category, icon,
  savings_label, is_popular, is_recommended
)
VALUES
  (
    'doc-print-student',
    'Студент',
    '50 страниц A4 ч/б каждый месяц',
    199.00,
    false,
    NULL,
    'monthly',
    15.00,
    3,
    true,
    10,
    '["50 страниц A4 ч/б в месяц", "Скидка 15% сверх лимита", "Перенос на 3 месяца"]'::jsonb,
    'doc-print',
    'print',
    'Экономия 34%',
    false,
    false
  ),
  (
    'doc-print-business',
    'Бизнес',
    '250 страниц A4 ч/б каждый месяц',
    999.00,
    false,
    NULL,
    'monthly',
    20.00,
    3,
    true,
    20,
    '["250 страниц A4 ч/б в месяц", "Скидка 20% сверх лимита", "Перенос на 3 месяца"]'::jsonb,
    'doc-print',
    'print',
    'Экономия 33%',
    true,
    true
  ),
  (
    'doc-print-office',
    'Офис',
    '800 страниц A4 ч/б каждый месяц',
    2490.00,
    false,
    NULL,
    'monthly',
    30.00,
    3,
    true,
    30,
    '["800 страниц A4 ч/б в месяц", "Скидка 30% сверх лимита", "Перенос на 3 месяца"]'::jsonb,
    'doc-print',
    'print',
    'Экономия 48%',
    false,
    false
  )
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  base_price = EXCLUDED.base_price,
  is_customizable = EXCLUDED.is_customizable,
  min_price = EXCLUDED.min_price,
  billing_period = EXCLUDED.billing_period,
  subscriber_discount_percent = EXCLUDED.subscriber_discount_percent,
  credits_rollover_months = EXCLUDED.credits_rollover_months,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order,
  features = EXCLUDED.features,
  category = EXCLUDED.category,
  icon = EXCLUDED.icon,
  savings_label = EXCLUDED.savings_label,
  is_popular = EXCLUDED.is_popular,
  is_recommended = EXCLUDED.is_recommended,
  updated_at = now();

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
