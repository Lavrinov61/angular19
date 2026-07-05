-- =============================================================================
-- update_online_pricing_v2.sql
-- =============================================================================
-- Премиум-позиционирование онлайн-услуг. Средний чек 890₽+ обеспечивает маржу
-- для партнёрской программы с lifetime commission.
--
-- Изменения:
--   photo-docs: 3 тарифа → 4 (Экспресс 490 / Профессиональный 890 /
--               Премиум 1490 / VIP «Все документы» 2490)
--   voennaya-retush: 1500/2500/3500/4500 → 1990/2990/4490/5990
--   extras: uniform 160→290, beard-removal 300→490,
--           all-docs-bundle 300→490, print-delivery 200→290, urgent 160→290
-- =============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- ФОТО НА ДОКУМЕНТЫ — тарифы уровня обработки
-- ────────────────────────────────────────────────────────────────────────────

-- Экспресс (was: Без обработки / basic)
-- AI-автообработка за 10 мин: якорная цена, большинство выберут Профессиональный
UPDATE service_options
SET
  name               = 'Экспресс',
  description        = 'Автоматическая обработка с AI, замена фона, файл за 10 мин',
  base_price         = 490,
  price_online       = 490,
  price_next_unit    = 490,
  promo_first_price  = 190,
  promo_description  = 'Первый заказ',
  features           = '["Замена фона на белый", "AI-автообработка", "Комплект 4–6 фото", "Готово за 10 минут"]'::jsonb,
  original_price     = 700,
  discount_percent   = 30,
  updated_at         = NOW()
WHERE slug = 'basic'
  AND option_group_id = (
    SELECT og.id FROM option_groups og
    JOIN service_categories sc ON sc.id = og.service_category_id
    WHERE og.slug = 'processing-level' AND sc.slug = 'photo-docs'
  );

-- Профессиональный (was: С обработкой / retouch) — основной revenue-драйвер
UPDATE service_options
SET
  name               = 'Профессиональный',
  description        = 'Ручная ретушь кожи, причёски, цветокоррекция',
  base_price         = 890,
  price_online       = 890,
  price_next_unit    = 890,
  promo_first_price  = 490,
  promo_description  = 'Первый заказ',
  features           = '["Ручная ретушь кожи и причёски", "Комплект 4–6 фото", "2 варианта на выбор", "Готово за 30 минут"]'::jsonb,
  popular            = true,
  original_price     = 1300,
  discount_percent   = 32,
  updated_at         = NOW()
WHERE slug = 'retouch'
  AND option_group_id = (
    SELECT og.id FROM option_groups og
    JOIN service_categories sc ON sc.id = og.service_category_id
    WHERE og.slug = 'processing-level' AND sc.slug = 'photo-docs'
  );

-- Премиум (was: VIP-обработка / vip) — upsell для требовательных
UPDATE service_options
SET
  name               = 'Премиум',
  description        = 'Премиальная ручная обработка, 4 варианта',
  base_price         = 1490,
  price_online       = 1490,
  price_next_unit    = 1490,
  promo_first_price  = 890,
  promo_description  = 'Первый заказ',
  features           = '["4 варианта обработки", "Срочная 15 мин — в подарок", "Премиальное качество", "Бесплатные правки"]'::jsonb,
  original_price     = 2000,
  discount_percent   = 26,
  updated_at         = NOW()
WHERE slug = 'vip'
  AND option_group_id = (
    SELECT og.id FROM option_groups og
    JOIN service_categories sc ON sc.id = og.service_category_id
    WHERE og.slug = 'processing-level' AND sc.slug = 'photo-docs'
  );

-- Новый 4-й тариф: VIP «Все документы» — «всё включено» пакет
INSERT INTO service_options (
  option_group_id, slug, name, description, icon, color,
  base_price, price_online, price_studio, price_next_unit,
  promo_first_price, promo_description,
  features, popular, original_price, discount_percent, sort_order
)
SELECT
  og.id,
  'vip-all-docs',
  'VIP «Все документы»',
  'Премиум обработка + 4 комплекта для всех ваших документов',
  'workspace_premium',
  '#e96f27',
  2490, 2490, 2490, 2490,
  1490, 'Первый заказ',
  '["4 комплекта (паспорт, загранпаспорт, права, виза)", "Премиальная ретушь", "Приоритетная обработка", "Бесплатные правки"]'::jsonb,
  false,
  3500,
  29,
  4
FROM option_groups og
JOIN service_categories sc ON sc.id = og.service_category_id
WHERE og.slug = 'processing-level' AND sc.slug = 'photo-docs'
ON CONFLICT (option_group_id, slug) DO NOTHING;

-- Обновить price_range для категории photo-docs
UPDATE service_categories
SET price_range = 'от 490₽', updated_at = NOW()
WHERE slug = 'photo-docs';

-- ────────────────────────────────────────────────────────────────────────────
-- ФОТО НА ДОКУМЕНТЫ — скорость и дополнения
-- ────────────────────────────────────────────────────────────────────────────

-- Срочная: 160 → 290
UPDATE service_options
SET base_price = 290, price_online = 290, price_studio = 290, updated_at = NOW()
WHERE slug = 'urgent'
  AND option_group_id = (
    SELECT og.id FROM option_groups og
    JOIN service_categories sc ON sc.id = og.service_category_id
    WHERE og.slug = 'speed' AND sc.slug = 'photo-docs'
  );

-- Подстановка формы: 160 → 290
UPDATE service_options
SET base_price = 290, price_online = 290, price_studio = 290, updated_at = NOW()
WHERE slug = 'uniform'
  AND option_group_id = (
    SELECT og.id FROM option_groups og
    JOIN service_categories sc ON sc.id = og.service_category_id
    WHERE og.slug = 'extras' AND sc.slug = 'photo-docs'
  );

-- Убрать бороду: 300 → 490
UPDATE service_options
SET base_price = 490, price_online = 490, price_studio = 490, updated_at = NOW()
WHERE slug = 'beard-removal';

-- На все документы (4 комплекта): 300 → 490
UPDATE service_options
SET base_price = 490, price_online = 490, price_studio = 490, updated_at = NOW()
WHERE slug = 'all-docs-bundle'
  AND option_group_id = (
    SELECT og.id FROM option_groups og
    JOIN service_categories sc ON sc.id = og.service_category_id
    WHERE og.slug = 'extras' AND sc.slug = 'photo-docs'
  );

-- Печать + доставка: 200 → 290
UPDATE service_options
SET base_price = 290, price_online = 290, price_studio = 290, updated_at = NOW()
WHERE slug = 'print-delivery'
  AND option_group_id = (
    SELECT og.id FROM option_groups og
    JOIN service_categories sc ON sc.id = og.service_category_id
    WHERE og.slug = 'extras' AND sc.slug = 'photo-docs'
  );

-- ────────────────────────────────────────────────────────────────────────────
-- ВОЕННАЯ РЕТУШЬ
-- ────────────────────────────────────────────────────────────────────────────
-- ВАЖНО: пакетная модель (1990/2990/4490/5990) отключена.
-- Актуальная модель цен задаётся миграцией update_voennaya_retush_options.sql
-- (конструктор: базовая ретушь + атрибутика + допы + скорость).

COMMIT;
