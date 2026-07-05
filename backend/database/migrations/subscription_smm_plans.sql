-- =============================================================================
-- subscription_smm_plans.sql
-- Adds category/icon/savings columns + seeds SMM subscription plans
-- =============================================================================

BEGIN;

-- Add new columns for plan presentation
ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'photo',
  ADD COLUMN IF NOT EXISTS icon VARCHAR(50) DEFAULT 'photo_camera',
  ADD COLUMN IF NOT EXISTS savings_label VARCHAR(100),
  ADD COLUMN IF NOT EXISTS is_popular BOOLEAN DEFAULT false;

-- Set defaults for existing photo plans
UPDATE subscription_plans SET category = 'photo', icon = 'photo_camera' WHERE category IS NULL OR category = 'photo';
UPDATE subscription_plans SET is_popular = true WHERE slug = 'family';

-- Seed SMM subscription plans
INSERT INTO subscription_plans (
  slug, name, description,
  base_price, billing_period,
  is_customizable, min_price,
  subscriber_discount_percent, credits_rollover_months,
  features, sort_order,
  category, icon, savings_label, is_popular
) VALUES
  (
    'smm-basic',
    'SMM Базовый',
    'Ежемесячное оформление соцсетей: 8 постов + 4 сторис',
    9900,
    'monthly',
    false,
    9900,
    20,
    0,
    '["8 оформленных постов", "4 сторис / рилс обложки", "Единый стиль", "Правки включены"]'::jsonb,
    10,
    'smm', 'calendar_month', '−20% vs разово', false
  ),
  (
    'smm-pro',
    'SMM Про',
    'Полное ведение: 16 постов + 8 сторис + шапка и обложки',
    18900,
    'monthly',
    false,
    18900,
    30,
    0,
    '["16 постов / мес", "8 сторис / рилс", "Шапка + обложки", "Контент-план", "Приоритет"]'::jsonb,
    11,
    'smm', 'workspace_premium', '−30% vs разово', true
  ),
  (
    'marketplace-support',
    'Маркетплейс Поддержка',
    'Ежемесячное обновление инфографики: 5 карточек (25 слайдов)',
    14900,
    'monthly',
    false,
    14900,
    25,
    0,
    '["5 карточек / мес", "25 слайдов", "A/B тест дизайна", "Аналитика"]'::jsonb,
    12,
    'smm', 'storefront', '−25% vs разово', false
  ),
  (
    'design-subscription',
    'Дизайн на постоянке',
    'Подписка на дизайн: до 10 задач в месяц любой сложности',
    29900,
    'monthly',
    false,
    29900,
    50,
    0,
    '["До 10 задач / мес", "Любые форматы", "Правки без лимита", "Выделенный дизайнер", "Срок 24–48ч"]'::jsonb,
    13,
    'smm', 'palette', 'Выгоднее в 2–3 раза', true
  )
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  base_price = EXCLUDED.base_price,
  features = EXCLUDED.features,
  category = EXCLUDED.category,
  icon = EXCLUDED.icon,
  savings_label = EXCLUDED.savings_label,
  is_popular = EXCLUDED.is_popular,
  sort_order = EXCLUDED.sort_order;

COMMIT;
