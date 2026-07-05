-- Account discount model:
-- personal < business < education, while paid print subscriptions unlock cheaper volume pricing.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS account_type VARCHAR(20);

UPDATE users
SET account_type = 'personal'
WHERE account_type IS NULL;

ALTER TABLE users
  ALTER COLUMN account_type SET DEFAULT 'personal',
  ALTER COLUMN account_type SET NOT NULL;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_account_type_check;

ALTER TABLE users
  ADD CONSTRAINT users_account_type_check
  CHECK (account_type IN ('personal', 'education', 'business'));

CREATE INDEX IF NOT EXISTS idx_users_account_type ON users(account_type);

COMMENT ON COLUMN users.account_type IS
  'Customer account type for pricing discounts: personal, education, business.';

UPDATE users u
SET account_type = 'education',
    updated_at = NOW()
FROM student_accounts sa
WHERE sa.user_id = u.id
  AND sa.status = 'verified'
  AND (sa.expires_at IS NULL OR sa.expires_at >= NOW())
  AND u.account_type IS DISTINCT FROM 'education';

UPDATE subscription_plans
SET credits_rollover_months = 0,
    description = CASE slug
      WHEN 'doc-print-student' THEN 'Дешевле печатать учебные документы при регулярном объеме. Без фиксированных кредитов.'
      WHEN 'doc-print-business' THEN 'Подписка для регулярной печати документов: цена ниже на объеме, платите за фактические страницы.'
      WHEN 'doc-print-office' THEN 'Офисная подписка на объемную печать A4 без пакета сгорающих кредитов.'
      WHEN 'launch-printscan-lite' THEN 'Стартовая подписка на печать документов: скидка на объем вместо фиксированных кредитов.'
      WHEN 'launch-printscan-biz' THEN 'Бизнес-подписка на печать документов: дешевле при регулярном объеме.'
      WHEN 'launch-printscan-pro' THEN 'Расширенная подписка на объемную печать документов.'
      WHEN 'photoprint-fan' THEN 'Фотопечать дешевле по подписке для регулярных семейных заказов. Без фиксированных кредитов.'
      WHEN 'photoprint-family' THEN 'Семейная подписка на фотопечать: цена ниже на объеме, платите за фактические снимки.'
      WHEN 'photoprint-photographer' THEN 'Профессиональная подписка на фотопечать с максимальной скидкой на объем без лимита кредитов.'
      WHEN 'launch-photoprint-lite' THEN 'Стартовая подписка на фотопечать: скидка на объем вместо фиксированных кредитов.'
      WHEN 'launch-photoprint-standard' THEN 'Регулярная фотопечать дешевле по подписке, без пакета сгорающих фото.'
      WHEN 'launch-photoprint-pro' THEN 'Максимальная скидка на объемную фотопечать для частых заказов.'
      WHEN 'photo-print-fan' THEN 'Фотопечать дешевле по подписке для регулярных заказов. Без фиксированных кредитов.'
      WHEN 'photo-print-family' THEN 'Семейная фотопечать дешевле по подписке, платите за фактические снимки.'
      WHEN 'photo-print-pro' THEN 'Профессиональная скидка на объемную фотопечать без фиксированного пакета.'
      ELSE description
    END,
    features = CASE slug
      WHEN 'doc-print-student' THEN '["Образовательная скидка аккаунта", "Цена ниже на объеме печати", "Без фиксированных кредитов и сгорающих остатков"]'::jsonb
      WHEN 'doc-print-business' THEN '["Бизнес-скидка аккаунта", "Цена ниже на регулярном объеме", "Оплата только фактически напечатанных страниц"]'::jsonb
      WHEN 'doc-print-office' THEN '["Офисная цена на объем", "Подходит для регулярной печати A4", "Без пакета фиксированных кредитов"]'::jsonb
      WHEN 'launch-printscan-lite' THEN '["Цена ниже по подписке", "Скидка применяется к услугам плана", "Без фиксированных кредитов"]'::jsonb
      WHEN 'launch-printscan-biz' THEN '["Цена ниже на объеме", "Скидка применяется к услугам плана", "Без фиксированных кредитов"]'::jsonb
      WHEN 'launch-printscan-pro' THEN '["Максимальная скидка по подписке", "Скидка применяется к услугам плана", "Без фиксированных кредитов"]'::jsonb
      WHEN 'photoprint-fan' THEN '["Фотопечать дешевле по подписке", "Скидка применяется к форматам плана", "Без фиксированных кредитов"]'::jsonb
      WHEN 'photoprint-family' THEN '["Цена ниже на семейном объеме", "Оплата только фактически напечатанных снимков", "Без сгорающего пакета фото"]'::jsonb
      WHEN 'photoprint-photographer' THEN '["Максимальная скидка на объем", "Подходит для регулярной фотопечати", "Без фиксированных кредитов"]'::jsonb
      WHEN 'launch-photoprint-lite' THEN '["Цена ниже по подписке", "Скидка применяется к форматам плана", "Без фиксированных кредитов"]'::jsonb
      WHEN 'launch-photoprint-standard' THEN '["Цена ниже на регулярной фотопечати", "Оплата фактического количества фото", "Без сгорающего пакета"]'::jsonb
      WHEN 'launch-photoprint-pro' THEN '["Максимальная скидка по подписке", "Для частой фотопечати", "Без фиксированных кредитов"]'::jsonb
      WHEN 'photo-print-fan' THEN '["Фотопечать дешевле по подписке", "Скидка применяется к форматам плана", "Без фиксированных кредитов"]'::jsonb
      WHEN 'photo-print-family' THEN '["Цена ниже на семейном объеме", "Оплата только фактически напечатанных снимков", "Без сгорающего пакета фото"]'::jsonb
      WHEN 'photo-print-pro' THEN '["Максимальная скидка на объем", "Подходит для регулярной фотопечати", "Без фиксированных кредитов"]'::jsonb
      ELSE features
    END,
    savings_label = CASE slug
      WHEN 'doc-print-student' THEN 'дешевле на учебном объеме'
      WHEN 'doc-print-business' THEN 'дешевле для регулярной печати'
      WHEN 'doc-print-office' THEN 'максимальная скидка на объем'
      WHEN 'launch-printscan-lite' THEN 'скидка на объем'
      WHEN 'launch-printscan-biz' THEN 'больше объем — ниже цена'
      WHEN 'launch-printscan-pro' THEN 'максимальная скидка на объем'
      WHEN 'photoprint-fan' THEN 'скидка на фотопечать'
      WHEN 'photoprint-family' THEN 'больше фото — ниже цена'
      WHEN 'photoprint-photographer' THEN 'максимальная скидка на фотопечать'
      WHEN 'launch-photoprint-lite' THEN 'скидка на фотопечать'
      WHEN 'launch-photoprint-standard' THEN 'больше фото — ниже цена'
      WHEN 'launch-photoprint-pro' THEN 'максимальная скидка на фотопечать'
      WHEN 'photo-print-fan' THEN 'скидка на фотопечать'
      WHEN 'photo-print-family' THEN 'больше фото — ниже цена'
      WHEN 'photo-print-pro' THEN 'максимальная скидка на фотопечать'
      ELSE savings_label
    END,
    updated_at = NOW()
WHERE slug IN (
  'doc-print-student',
  'doc-print-business',
  'doc-print-office',
  'launch-printscan-lite',
  'launch-printscan-biz',
  'launch-printscan-pro',
  'photoprint-fan',
  'photoprint-family',
  'photoprint-photographer',
  'launch-photoprint-lite',
  'launch-photoprint-standard',
  'launch-photoprint-pro',
  'photo-print-fan',
  'photo-print-family',
  'photo-print-pro'
);

UPDATE subscription_plan_items
SET included_quantity = 0
WHERE plan_id IN (
  SELECT id
  FROM subscription_plans
  WHERE slug IN (
    'doc-print-student',
    'doc-print-business',
    'doc-print-office',
    'launch-printscan-lite',
    'launch-printscan-biz',
    'launch-printscan-pro',
    'photoprint-fan',
    'photoprint-family',
    'photoprint-photographer',
    'launch-photoprint-lite',
    'launch-photoprint-standard',
    'launch-photoprint-pro',
    'photo-print-fan',
    'photo-print-family',
    'photo-print-pro'
  )
);
