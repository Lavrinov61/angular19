BEGIN;

UPDATE subscription_plans
SET slug = 'education-monthly-199',
    updated_at = NOW()
WHERE slug = 'education-yearly-199'
  AND NOT EXISTS (
    SELECT 1
    FROM subscription_plans
    WHERE slug = 'education-monthly-199'
  );

UPDATE subscription_plans
SET name = 'Образовательный 199',
    description = 'Подписка 199 ₽ в месяц после проверки статуса активирует образовательные скидки: 70% на печать документов А4 и 30% на фотопечать от 10x15 до А4.',
    category = 'education',
    base_price = 199.00,
    billing_period = 'monthly',
    subscriber_discount_percent = 0.00,
    credits_rollover_months = 0,
    is_active = true,
    sort_order = 5,
    is_popular = true,
    is_recommended = true,
    features = '["199 ₽ в месяц после проверки статуса", "Документы А4: 10→3 ₽, 12→4 ₽, 25→8 ₽, 40→12 ₽, 60→18 ₽", "Фотопечать 10x15-А4: 20→14 ₽", "Без фиксированных кредитов"]'::jsonb,
    savings_label = '70% документы, 30% фото',
    updated_at = NOW()
WHERE slug IN ('education-monthly-199', 'education-yearly-199');

COMMIT;
