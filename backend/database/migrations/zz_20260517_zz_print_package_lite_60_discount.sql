BEGIN;

UPDATE subscription_plans
SET name = 'до 50 листов A4',
    description = 'Пакет печати документов до 50 листов A4. Действует 1 месяц после покупки.',
    base_price = 199.00,
    features = '["до 50 листов A4", "Действует 1 месяц", "Ч/б x1, цвет x1.2 до 15%"]'::jsonb,
    savings_label = 'Экономия 60%',
    updated_at = NOW()
WHERE slug = 'launch-printscan-lite';

WITH lite_plan AS (
  SELECT id
  FROM subscription_plans
  WHERE slug = 'launch-printscan-lite'
),
updated_lite_item AS (
  UPDATE subscription_plan_items spi
  SET included_quantity = 50
  FROM lite_plan
  WHERE spi.plan_id = lite_plan.id
    AND spi.product_id = 'a2000001-0000-0000-0000-000000000001'
  RETURNING spi.plan_id
)
INSERT INTO subscription_plan_items (plan_id, product_id, included_quantity, is_required, sort_order)
SELECT lite_plan.id, 'a2000001-0000-0000-0000-000000000001', 50, true, 10
FROM lite_plan
WHERE NOT EXISTS (SELECT 1 FROM updated_lite_item);

UPDATE subscription_plans
SET name = 'до 250 листов A4',
    description = 'Пакет печати документов до 250 листов A4. Действует 1 месяц после покупки.',
    features = '["до 250 листов A4", "Действует 1 месяц", "Ч/б x1, цвет x1.2 до 15%"]'::jsonb,
    updated_at = NOW()
WHERE slug = 'launch-printscan-biz';

UPDATE subscription_plans
SET name = 'до 800 листов A4',
    description = 'Пакет печати документов до 800 листов A4. Действует 1 месяц после покупки.',
    features = '["до 800 листов A4", "Действует 1 месяц", "Ч/б x1, цвет x1.2 до 15%"]'::jsonb,
    updated_at = NOW()
WHERE slug = 'launch-printscan-pro';

COMMIT;
