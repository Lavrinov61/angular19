-- Reactivate photo-print subscriptions (discount-based, profitable)
-- and add is_recommended column for marketing page
-- Idempotent: safe to run multiple times
-- 2026-03-27

BEGIN;

-- ═══════════════════════════════════════════════════════════
-- 1. Add is_recommended column
-- ═══════════════════════════════════════════════════════════
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS is_recommended BOOLEAN DEFAULT false;

-- ═══════════════════════════════════════════════════════════
-- 2. Reactivate discount-based photo-print plans
--    (NOT credit-based — those are loss-making)
--    Margin analysis: paper margin 64-74%, so 10-20% discount
--    leaves 44-64% margin — fully profitable.
-- ═══════════════════════════════════════════════════════════

-- Любитель: 299₽/мес, 10% скидка
UPDATE subscription_plans SET
  is_active = true,
  base_price = 299,
  name = 'Любитель',
  features = '["Скидка 10% на все форматы фотопечати", "До 50 фото/мес по скидке", "Глянец и матовая бумага", "Онлайн-заказ с доставкой"]'::jsonb,
  description = 'Идеально для тех, кто печатает семейные фото и снимки из путешествий. Экономия от 100₽/мес при регулярной печати.',
  savings_label = 'Экономия ~100₽/мес',
  is_popular = false,
  is_recommended = false,
  icon = 'photo_camera',
  sort_order = 20,
  updated_at = NOW()
WHERE slug = 'photoprint-fan';

-- Семейный: 699₽/мес, 15% скидка — РЕКОМЕНДУЕМЫЙ
UPDATE subscription_plans SET
  is_active = true,
  base_price = 699,
  name = 'Семейный',
  features = '["Скидка 15% на все форматы фотопечати", "До 200 фото/мес по скидке", "Все форматы до 30×40", "Бесплатное кадрирование", "Приоритетная обработка"]'::jsonb,
  description = 'Для семей, которые ценят домашний фотоархив. Печатайте больше — платите меньше. Самый популярный выбор.',
  savings_label = 'Экономия ~300₽/мес',
  is_popular = true,
  is_recommended = true,
  icon = 'family_restroom',
  sort_order = 21,
  updated_at = NOW()
WHERE slug = 'photoprint-family';

-- Фотограф: 1490₽/мес, 20% скидка
UPDATE subscription_plans SET
  is_active = true,
  base_price = 1490,
  name = 'Фотограф',
  features = '["Скидка 20% на все форматы фотопечати", "Безлимитная печать по скидке", "Профессиональная бумага (суперглянец, сатин)", "Приоритетная очередь", "Персональный менеджер"]'::jsonb,
  description = 'Для профессиональных фотографов. Максимальная скидка, приоритет, все виды бумаги. Окупается от 50 фото A4/мес.',
  savings_label = 'Экономия до 30%',
  is_popular = false,
  is_recommended = false,
  icon = 'camera_alt',
  sort_order = 22,
  updated_at = NOW()
WHERE slug = 'photoprint-photographer';

-- ═══════════════════════════════════════════════════════════
-- 3. Update descriptions/features for other active categories
-- ═══════════════════════════════════════════════════════════

-- doc-print: update descriptions for marketing page
UPDATE subscription_plans SET
  description = 'Для студентов и фрилансеров: распечатки конспектов, рефератов, документов. Дешевле, чем в копировальном центре.',
  savings_label = 'Дешевле копицентра',
  is_recommended = false,
  updated_at = NOW()
WHERE slug = 'doc-print-student' AND description IS DISTINCT FROM 'Для студентов и фрилансеров: распечатки конспектов, рефератов, документов. Дешевле, чем в копировальном центре.';

UPDATE subscription_plans SET
  description = 'Для малого бизнеса: договоры, счета, презентации. Включает цветную и A3 печать.',
  savings_label = 'Хит продаж',
  is_recommended = true,
  updated_at = NOW()
WHERE slug = 'doc-print-business' AND is_recommended IS DISTINCT FROM true;

UPDATE subscription_plans SET
  description = 'Для офисов с большим объёмом: полный безлимит, все форматы, доставка в офис.',
  savings_label = 'Максимум экономии',
  is_recommended = false,
  updated_at = NOW()
WHERE slug = 'doc-print-office' AND description IS DISTINCT FROM 'Для офисов с большим объёмом: полный безлимит, все форматы, доставка в офис.';

-- photo-docs: update descriptions
UPDATE subscription_plans SET
  description = 'Для визовых центров, HR-агентств, кадровых служб. Быстрая съёмка + ретушь под стандарты.',
  savings_label = 'от 398₽/комплект',
  is_recommended = false,
  updated_at = NOW()
WHERE slug = 'photo-docs-agent' AND description IS DISTINCT FROM 'Для визовых центров, HR-агентств, кадровых служб. Быстрая съёмка + ретушь под стандарты.';

UPDATE subscription_plans SET
  description = 'Для крупных агентств: большой объём, нейро-стандарт, приоритет. Максимальная экономия.',
  savings_label = 'Хит для агентств',
  is_recommended = true,
  updated_at = NOW()
WHERE slug = 'photo-docs-agency' AND is_recommended IS DISTINCT FROM true;

UPDATE subscription_plans SET
  description = 'Для корпоративных клиентов: неограниченный объём, выделенный менеджер, выезд фотографа.',
  savings_label = 'VIP',
  is_recommended = false,
  updated_at = NOW()
WHERE slug = 'photo-docs-corp' AND description IS DISTINCT FROM 'Для корпоративных клиентов: неограниченный объём, выделенный менеджер, выезд фотографа.';

-- retouch: update descriptions
UPDATE subscription_plans SET
  description = 'Для блогеров и мамочек: базовая ретушь портретов, пейзажей, семейных фото.',
  savings_label = 'Выгоднее разовой на 30%',
  is_recommended = false,
  updated_at = NOW()
WHERE slug = 'retouch-fan' AND description IS DISTINCT FROM 'Для блогеров и мамочек: базовая ретушь портретов, пейзажей, семейных фото.';

UPDATE subscription_plans SET
  description = 'Для профессионалов: все виды ретуши, от свадеб до каталогов. Окупается от 3 заказов/мес.',
  savings_label = 'Хит для фотографов',
  is_recommended = true,
  updated_at = NOW()
WHERE slug = 'retouch-pro' AND is_recommended IS DISTINCT FROM true;

UPDATE subscription_plans SET
  description = 'Для студий и агентств: максимальный объём, все виды обработки, приоритет.',
  savings_label = 'Экономия до 40%',
  is_recommended = false,
  updated_at = NOW()
WHERE slug = 'retouch-studio' AND description IS DISTINCT FROM 'Для студий и агентств: максимальный объём, все виды обработки, приоритет.';

-- scan: update descriptions
UPDATE subscription_plans SET
  description = 'Оцифровка семейных фотоальбомов и документов. Быстро, качественно, с хранением.',
  savings_label = 'Выгоднее разового',
  is_recommended = false,
  updated_at = NOW()
WHERE slug = 'scan-lite' AND description IS DISTINCT FROM 'Оцифровка семейных фотоальбомов и документов. Быстро, качественно, с хранением.';

UPDATE subscription_plans SET
  description = 'Для постоянной оцифровки: большой объём, ручное сканирование, кадрирование.',
  savings_label = 'Хит для архивов',
  is_recommended = true,
  updated_at = NOW()
WHERE slug = 'scan-pro' AND is_recommended IS DISTINCT FROM true;

UPDATE subscription_plans SET
  description = 'Для бизнеса: неограниченная оцифровка, ламинирование, приоритет.',
  savings_label = 'Полный пакет',
  is_recommended = false,
  updated_at = NOW()
WHERE slug = 'scan-biz' AND description IS DISTINCT FROM 'Для бизнеса: неограниченная оцифровка, ламинирование, приоритет.';

-- ═══════════════════════════════════════════════════════════
-- 4. Deactivate old credit-based photo-print plans (keep for history)
-- ═══════════════════════════════════════════════════════════
UPDATE subscription_plans SET is_active = false
WHERE slug IN ('photo-print-fan', 'photo-print-family', 'photo-print-pro')
  AND is_active = true;

COMMIT;
