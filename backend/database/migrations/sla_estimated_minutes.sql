-- Миграция: реальные estimated_minutes для SLA-дедлайнов
-- Формула дедлайна: MAX(single-select groups) + SUM(multi-select groups)
-- Speed группа → SLA-обещание клиенту (определяет дедлайн)
-- Extras → добавочное время обработки

BEGIN;

-- ============================================================================
-- photo-docs: Фото на документы
-- ============================================================================

-- document-type (single) → 0 мин: тип документа не влияет на время
UPDATE service_options SET estimated_minutes = 0
WHERE option_group_id IN (
  SELECT id FROM option_groups WHERE slug = 'document-type'
    AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'photo-docs')
);

-- processing-level (single) → реальное время ретуши
UPDATE service_options SET estimated_minutes = 15
WHERE slug = 'retouch' AND option_group_id IN (
  SELECT id FROM option_groups WHERE slug = 'processing-level'
    AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'photo-docs')
);
-- Экспресс (если есть) — только печать, без ретуши
UPDATE service_options SET estimated_minutes = 5
WHERE slug = 'express' AND option_group_id IN (
  SELECT id FROM option_groups WHERE slug = 'processing-level'
    AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'photo-docs')
);
UPDATE service_options SET estimated_minutes = 20
WHERE slug = 'vip' AND option_group_id IN (
  SELECT id FROM option_groups WHERE slug = 'processing-level'
    AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'photo-docs')
);
UPDATE service_options SET estimated_minutes = 30
WHERE slug = 'vip-all-docs' AND option_group_id IN (
  SELECT id FROM option_groups WHERE slug = 'processing-level'
    AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'photo-docs')
);

-- speed (single) → SLA-обещание клиенту (ОПРЕДЕЛЯЕТ ДЕДЛАЙН)
UPDATE service_options SET estimated_minutes = 180  -- 3 часа
WHERE slug = 'normal' AND option_group_id IN (
  SELECT id FROM option_groups WHERE slug = 'speed'
    AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'photo-docs')
);
UPDATE service_options SET estimated_minutes = 60  -- 1 час
WHERE slug = 'urgent' AND option_group_id IN (
  SELECT id FROM option_groups WHERE slug = 'speed'
    AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'photo-docs')
);

-- extras (multi) → добавочное время
UPDATE service_options SET estimated_minutes = 60  -- подстановка формы до 1 часа
WHERE slug = 'uniform' AND option_group_id IN (
  SELECT id FROM option_groups WHERE slug = 'extras'
    AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'photo-docs')
);
UPDATE service_options SET estimated_minutes = 15  -- убрать бороду
WHERE slug = 'beard-removal' AND option_group_id IN (
  SELECT id FROM option_groups WHERE slug = 'extras'
    AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'photo-docs')
);
UPDATE service_options SET estimated_minutes = 5  -- печать + доставка
WHERE slug = 'print-delivery' AND option_group_id IN (
  SELECT id FROM option_groups WHERE slug = 'extras'
    AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'photo-docs')
);
-- portrait, all-docs (если есть)
UPDATE service_options SET estimated_minutes = 30
WHERE slug = 'portrait' AND option_group_id IN (
  SELECT id FROM option_groups WHERE slug = 'extras'
    AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'photo-docs')
);
UPDATE service_options SET estimated_minutes = 10
WHERE slug = 'all-docs-4' AND option_group_id IN (
  SELECT id FROM option_groups WHERE slug = 'extras'
    AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'photo-docs')
);

-- ============================================================================
-- voennaya-retush: Парадный Герой
-- ============================================================================

-- retouching (single) → время обработки
UPDATE service_options SET estimated_minutes = 30  -- простая обработка
WHERE slug = 'simple' AND option_group_id IN (
  SELECT id FROM option_groups WHERE slug = 'retouching'
    AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'voennaya-retush')
);
UPDATE service_options SET estimated_minutes = 60  -- художественная
WHERE slug = 'artistic' AND option_group_id IN (
  SELECT id FROM option_groups WHERE slug = 'retouching'
    AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'voennaya-retush')
);
UPDATE service_options SET estimated_minutes = 120  -- восстановление + обработка
WHERE slug = 'restoration' AND option_group_id IN (
  SELECT id FROM option_groups WHERE slug = 'retouching'
    AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'voennaya-retush')
);

-- military (multi) → добавочное время
UPDATE service_options SET estimated_minutes = 30  -- подстановка формы
WHERE slug = 'uniform' AND option_group_id IN (
  SELECT id FROM option_groups WHERE slug = 'military'
    AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'voennaya-retush')
);
UPDATE service_options SET estimated_minutes = 15  -- медали и погоны
WHERE slug = 'medals' AND option_group_id IN (
  SELECT id FROM option_groups WHERE slug = 'military'
    AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'voennaya-retush')
);
UPDATE service_options SET estimated_minutes = 10  -- шевроны и нашивки
WHERE slug = 'chevrons' AND option_group_id IN (
  SELECT id FROM option_groups WHERE slug = 'military'
    AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'voennaya-retush')
);

-- extras (multi) → добавочное время
UPDATE service_options SET estimated_minutes = 15  -- убрать бороду
WHERE slug = 'beard-removal' AND option_group_id IN (
  SELECT id FROM option_groups WHERE slug = 'extras'
    AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'voennaya-retush')
);
UPDATE service_options SET estimated_minutes = 10  -- подарочное оформление
WHERE slug = 'gift-frame' AND option_group_id IN (
  SELECT id FROM option_groups WHERE slug = 'extras'
    AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'voennaya-retush')
);
UPDATE service_options SET estimated_minutes = 5  -- дополнительный формат
WHERE slug = 'extra-format' AND option_group_id IN (
  SELECT id FROM option_groups WHERE slug = 'extras'
    AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'voennaya-retush')
);

-- speed (single) → SLA-обещание
UPDATE service_options SET estimated_minutes = 2880  -- 2 дня
WHERE slug = 'normal' AND option_group_id IN (
  SELECT id FROM option_groups WHERE slug = 'speed'
    AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'voennaya-retush')
);
UPDATE service_options SET estimated_minutes = 720  -- 12 часов
WHERE slug = 'urgent' AND option_group_id IN (
  SELECT id FROM option_groups WHERE slug = 'speed'
    AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'voennaya-retush')
);

-- hero-bundles (single) → время обработки комплекта
UPDATE service_options SET estimated_minutes = 60   -- Базовый Герой
WHERE slug = 'hero-basic' AND option_group_id IN (
  SELECT id FROM option_groups WHERE slug = 'hero-bundles'
    AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'voennaya-retush')
);
UPDATE service_options SET estimated_minutes = 90   -- Полный Герой
WHERE slug = 'hero-full' AND option_group_id IN (
  SELECT id FROM option_groups WHERE slug = 'hero-bundles'
    AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'voennaya-retush')
);
UPDATE service_options SET estimated_minutes = 120  -- Премиум Герой
WHERE slug = 'hero-premium' AND option_group_id IN (
  SELECT id FROM option_groups WHERE slug = 'hero-bundles'
    AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'voennaya-retush')
);

-- ============================================================================
-- copy-print: Ксерокопия и печать — мгновенные услуги
-- ============================================================================
UPDATE service_options SET estimated_minutes = 2
WHERE option_group_id IN (
  SELECT id FROM option_groups
  WHERE service_category_id = (SELECT id FROM service_categories WHERE slug = 'copy-print')
);

-- ============================================================================
-- photo-print-format / photo-print: Фотопечать — быстрая печать
-- ============================================================================
UPDATE service_options SET estimated_minutes = 5
WHERE option_group_id IN (
  SELECT id FROM option_groups
  WHERE service_category_id IN (
    SELECT id FROM service_categories WHERE slug IN ('photo-print-format', 'photo-print')
  )
);

-- ============================================================================
-- scan-services: Сканирование — мгновенные услуги
-- ============================================================================
UPDATE service_options SET estimated_minutes = 3
WHERE option_group_id IN (
  SELECT id FROM option_groups
  WHERE service_category_id IN (SELECT id FROM service_categories WHERE slug IN ('scan-services', 'scan-copy'))
);

-- ============================================================================
-- restoration / photo-restore: Реставрация — зависит от сложности
-- ============================================================================
-- Обновление по сложности реставрации
UPDATE service_options so SET estimated_minutes = CASE
  WHEN so.name ILIKE '%простая%' THEN 30
  WHEN so.name ILIKE '%средняя%' THEN 90
  WHEN so.name ILIKE '%гравировку%' THEN 120
  WHEN so.name ILIKE '%сложная%' THEN 180
  WHEN so.name ILIKE '%профи%' THEN 240
  ELSE 60
END
WHERE so.option_group_id IN (
  SELECT id FROM option_groups WHERE service_category_id IN (
    SELECT id FROM service_categories WHERE slug IN ('restoration', 'photo-restore')
  )
);

-- ============================================================================
-- retouch: Ретушь и обработка
-- ============================================================================
UPDATE service_options so SET estimated_minutes = CASE
  WHEN so.slug = 'portfolio-retouch' THEN 15           -- простая ретушь
  WHEN so.slug = 'retouch-reportage' THEN 30           -- репортажная
  WHEN so.slug = 'studio-retouch-basic' THEN 30        -- базовая
  WHEN so.slug = 'studio-retouch-pro' THEN 60          -- профессиональная
  WHEN so.slug = 'studio-retouch-premium' THEN 90      -- премиальная
  ELSE 30
END
WHERE so.option_group_id IN (
  SELECT id FROM option_groups WHERE service_category_id = (
    SELECT id FROM service_categories WHERE slug = 'retouch'
  )
);

-- ============================================================================
-- design-text: Дизайн и тексты
-- ============================================================================
UPDATE service_options so SET estimated_minutes = CASE
  WHEN so.slug = 'text-layout' THEN 10           -- размещение текста
  WHEN so.slug = 'text-edit' THEN 15              -- редактирование
  WHEN so.slug = 'text-set' THEN 30               -- набор текста
  WHEN so.slug = 'design-card' THEN 15            -- дизайн визитки
  WHEN so.slug = 'design-flyer' THEN 30           -- дизайн листовки
  WHEN so.slug = 'design-pricelist' THEN 60       -- дизайн прайс-листа
  WHEN so.slug = 'design-booklet' THEN 120        -- дизайн буклета
  WHEN so.slug = 'design-menu' THEN 180           -- дизайн меню
  ELSE 30
END
WHERE so.option_group_id IN (
  SELECT id FROM option_groups WHERE service_category_id = (
    SELECT id FROM service_categories WHERE slug = 'design-text'
  )
);

-- ============================================================================
-- polygraphy: Визитки и полиграфия
-- ============================================================================
UPDATE service_options so SET estimated_minutes = CASE
  WHEN so.name ILIKE '%образцы%' THEN 15     -- образцы 2 шт = дизайн + печать
  WHEN so.name ILIKE '%бумага%' THEN 20      -- печать+резка 100 шт
  WHEN so.name ILIKE '%пластик%' THEN 30     -- печать на пластике дольше
  ELSE 20
END
WHERE so.option_group_id IN (
  SELECT id FROM option_groups WHERE service_category_id = (
    SELECT id FROM service_categories WHERE slug = 'polygraphy'
  )
);

-- ============================================================================
-- frames-souvenirs: Рамки и сувениры
-- ============================================================================
UPDATE service_options so SET estimated_minutes = CASE
  WHEN so.name ILIKE '%рамка%' THEN 10          -- вставить фото в рамку
  WHEN so.name ILIKE '%кружк%' THEN 30          -- сублимация на кружке
  WHEN so.name ILIKE '%футбол%' THEN 30         -- печать на футболке
  WHEN so.name ILIKE '%холст%' THEN 30          -- печать на холсте
  ELSE 15
END
WHERE so.option_group_id IN (
  SELECT id FROM option_groups WHERE service_category_id = (
    SELECT id FROM service_categories WHERE slug = 'frames-souvenirs'
  )
);

-- ============================================================================
-- portrait: Портретная съёмка
-- ============================================================================
UPDATE service_options so SET estimated_minutes = CASE
  WHEN so.slug = 'portrait-photo' THEN 15           -- съёмка 10-15 мин
  WHEN so.slug = 'portrait-retouch-option' THEN 60  -- ретушь портрета
  WHEN so.slug = 'portrait-full-set' THEN 30        -- подготовка всех исходников
  ELSE 5  -- форматы печати — быстро
END
WHERE so.option_group_id IN (
  SELECT id FROM option_groups WHERE service_category_id = (
    SELECT id FROM service_categories WHERE slug = 'portrait'
  )
);

-- ============================================================================
-- neuro-photo: Нейрофотосессия
-- ============================================================================
UPDATE service_options so SET estimated_minutes = CASE
  WHEN so.slug = 'neuro-mini' THEN 60         -- 1 фото: генерация + ретушь
  WHEN so.slug = 'neuro-standard' THEN 180    -- 4 фото
  WHEN so.slug = 'neuro-full' THEN 480        -- 10-15 фото
  ELSE 60
END
WHERE so.option_group_id IN (
  SELECT id FROM option_groups WHERE service_category_id = (
    SELECT id FROM service_categories WHERE slug = 'neuro-photo'
  )
);

-- ============================================================================
-- studio-special: Студийные и спец. услуги
-- ============================================================================
UPDATE service_options so SET estimated_minutes = CASE
  WHEN so.slug = 'polaroid-reportage' THEN 5       -- моментальное фото
  WHEN so.slug = 'custom-order' THEN 60             -- индивидуальный заказ
  WHEN so.slug = 'immortal-regiment' THEN 30        -- бессмертный полк
  WHEN so.slug ILIKE '%портретное%' THEN 30         -- портретное фото
  WHEN so.slug = 'memorial-photo' THEN 60           -- фото на памятник
  WHEN so.slug = 'event-photography' THEN 180       -- фотосъёмка событий
  ELSE 30
END
WHERE so.option_group_id IN (
  SELECT id FROM option_groups WHERE service_category_id = (
    SELECT id FROM service_categories WHERE slug = 'studio-special'
  )
);

-- ============================================================================
-- marketplace-photo / smm-content / selling-pack / infographics — проектные
-- ============================================================================
UPDATE service_options so SET estimated_minutes = CASE
  WHEN so.slug = '10-articles' THEN 480        -- 10 артикулов = полный день
  WHEN so.slug = '360-photo' THEN 60           -- 360° фото
  WHEN so.slug = 'model-lifestyle' THEN 240    -- с моделью
  WHEN so.slug = 'single-card' THEN 120        -- 1 карточка инфографика
  WHEN so.slug = 'pack-10' THEN 960            -- 10 карточек
  WHEN so.slug = 'full-design' THEN 240        -- полный дизайн + текст
  WHEN so.slug = 'single-reels' THEN 180       -- 1 Reels
  WHEN so.slug = 'pack-5-reels' THEN 960       -- 5 Reels
  WHEN so.slug = 'monthly-plan' THEN 2880      -- контент-план на месяц
  WHEN so.slug = 'selling-standard' THEN 2880  -- продающий пакет
  ELSE 120
END
WHERE so.option_group_id IN (
  SELECT id FROM option_groups WHERE service_category_id IN (
    SELECT id FROM service_categories WHERE slug IN (
      'marketplace-photo', 'smm-content', 'selling-pack', 'infographics'
    )
  )
);

-- ============================================================================
-- drawings: Печать чертежей — мгновенно
-- ============================================================================
UPDATE service_options SET estimated_minutes = 2
WHERE option_group_id IN (
  SELECT id FROM option_groups WHERE service_category_id = (
    SELECT id FROM service_categories WHERE slug = 'drawings'
  )
);

-- ============================================================================
-- students: Студентам — аналогично печати
-- ============================================================================
UPDATE service_options SET estimated_minutes = 5
WHERE option_group_id IN (
  SELECT id FROM option_groups WHERE service_category_id = (
    SELECT id FROM service_categories WHERE slug = 'students'
  )
);

-- ============================================================================
-- km-studio (Контур.Маркет) — аналогично photo-docs
-- ============================================================================
UPDATE service_options SET estimated_minutes = 15
WHERE option_group_id IN (
  SELECT id FROM option_groups WHERE slug = 'km-studio'
);

-- ============================================================================
-- Оставшиеся с дефолтом 30 → выставляем 0 для misc/souvenirs/design
-- ============================================================================
-- event-photo, portfolio и misc-services — проектные, дедлайн индивидуальный
-- Оставляем 30 как разумный дефолт для неклассифицированных

-- ============================================================================
-- Верификация
-- ============================================================================
-- SELECT sc.slug, og.slug, so.name, so.estimated_minutes
-- FROM service_options so
-- JOIN option_groups og ON og.id = so.option_group_id
-- JOIN service_categories sc ON sc.id = og.service_category_id
-- ORDER BY sc.slug, og.sort_order, so.sort_order;

COMMIT;
