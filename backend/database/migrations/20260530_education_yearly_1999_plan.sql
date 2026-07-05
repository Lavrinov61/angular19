-- Годовая образовательная подписка: 1999 ₽/год (выгоднее, чем 12×199 = 2388 ₽).
-- Списание раз в год (рекуррент CloudPayments Month×12 — задаётся billing_period='yearly').
-- Льгота та же, что у месячной: 70% документы А4 / 30% фото (account_discount education).
-- Доступ к льготе даётся по slug-allowlist EDUCATION_ACCESS_PLAN_SLUGS (см. subscription.service.ts).
-- Идемпотентно: ON CONFLICT (slug) DO UPDATE.

INSERT INTO subscription_plans (
  slug, name, description, base_price, billing_period, category,
  is_active, sort_order, is_recommended, is_popular, savings_label,
  subscriber_discount_percent, credits_rollover_months, icon, features, usage_policy
) VALUES (
  'education-yearly-1999',
  'Образовательный (год)',
  'Годовая подписка 1999 ₽ — выгоднее, чем 12 месяцев по 199 ₽ (экономия 389 ₽). Те же образовательные скидки: 70% на печать документов А4 и 30% на фотопечать от 10×15 до А4. Списание раз в год.',
  1999.00,
  'yearly',
  'education',
  true,
  6,
  false,
  false,
  'Экономия 389 ₽ в год',
  0,
  0,
  'school',
  '["1999 ₽ в год после проверки статуса (выгоднее на 389 ₽)", "Документы А4: 10→3 ₽, 12→4 ₽, 25→8 ₽, 40→12 ₽, 60→18 ₽", "Фотопечать 10×15-А4: 20→14 ₽", "Списание раз в год, без фиксированных кредитов"]'::jsonb,
  '{}'::jsonb
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  base_price = EXCLUDED.base_price,
  billing_period = EXCLUDED.billing_period,
  category = EXCLUDED.category,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order,
  savings_label = EXCLUDED.savings_label,
  icon = EXCLUDED.icon,
  features = EXCLUDED.features,
  updated_at = NOW();
