-- Rename the monthly 199 ₽ document plan into the account discount activation plan.
-- Education uses the separate yearly 199 ₽ plan from zz_20260509_education_access_roles_and_plan.sql.

UPDATE subscription_plans
SET name = 'Аккаунт 199',
    description = 'Подписка 199 ₽ в месяц активирует скидки личного или бизнес аккаунта. Без фиксированных кредитов.',
    base_price = 199.00,
    billing_period = 'monthly',
    subscriber_discount_percent = 0.00,
    credits_rollover_months = 0,
    is_active = true,
    sort_order = 5,
    is_popular = true,
    is_recommended = true,
    features = '["199 ₽ в месяц", "Личный аккаунт: А4 10→8 ₽, фото 20→18 ₽", "Бизнес аккаунт: А4 10→6 ₽, фото 20→17 ₽", "Без фиксированных кредитов"]'::jsonb,
    savings_label = 'активация скидок аккаунта',
    updated_at = NOW()
WHERE slug = 'doc-print-student';

UPDATE subscription_plans
SET name = 'Образовательный 199',
    description = 'Подписка 199 ₽ в год после проверки статуса активирует образовательные скидки: 70% на печать документов А4 и 30% на фотопечать от 10x15 до А4.',
    category = 'education',
    base_price = 199.00,
    billing_period = 'yearly',
    subscriber_discount_percent = 0.00,
    credits_rollover_months = 0,
    is_active = true,
    sort_order = 5,
    is_popular = true,
    is_recommended = true,
    features = '["199 ₽ в год после проверки статуса", "Документы А4: 10→3 ₽, 12→4 ₽, 25→8 ₽, 40→12 ₽, 60→18 ₽", "Фотопечать 10x15-А4: 20→14 ₽", "Без фиксированных кредитов"]'::jsonb,
    savings_label = '70% документы, 30% фото',
    updated_at = NOW()
WHERE slug = 'education-yearly-199';
