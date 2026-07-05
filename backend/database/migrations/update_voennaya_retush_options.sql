-- Update voennaya-retush pricing: replace packages with options (like photo-docs)
-- This migration replaces the single "package" group with multiple option groups

BEGIN;

-- 1. Remove old options and group
DELETE FROM service_options
WHERE option_group_id IN (
  SELECT id FROM option_groups
  WHERE service_category_id = (SELECT id FROM service_categories WHERE slug = 'voennaya-retush')
);

DELETE FROM option_groups
WHERE service_category_id = (SELECT id FROM service_categories WHERE slug = 'voennaya-retush');

-- 2. Update category price range
UPDATE service_categories
SET price_range = 'от 490₽',
    description = 'Военная ретушь: форма, медали, погоны, удаление бороды, реставрация'
WHERE slug = 'voennaya-retush';

-- 3. Create option groups
INSERT INTO option_groups (service_category_id, slug, name, description, selection_type, is_required, max_selections, sort_order)
VALUES
    ((SELECT id FROM service_categories WHERE slug = 'voennaya-retush'),
     'retouching', 'Базовая ретушь', 'Уровень обработки фотографии', 'single', true, 1, 1),
    ((SELECT id FROM service_categories WHERE slug = 'voennaya-retush'),
     'military', 'Форма и атрибутика', 'Военная форма, медали, знаки отличия', 'multi', false, 10, 2),
    ((SELECT id FROM service_categories WHERE slug = 'voennaya-retush'),
     'extras', 'Дополнительно', 'Дополнительные опции к заказу', 'multi', false, 10, 3),
    ((SELECT id FROM service_categories WHERE slug = 'voennaya-retush'),
     'speed', 'Скорость', 'Время готовности заказа', 'single', false, 1, 4)
ON CONFLICT (service_category_id, slug) DO NOTHING;

-- 4. Options: Базовая ретушь (single, required)
INSERT INTO service_options (option_group_id, slug, name, description, icon, color,
    base_price, price_online, price_studio,
    features, popular, original_price, discount_percent, sort_order)
VALUES
    ((SELECT id FROM option_groups WHERE slug = 'retouching' AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'voennaya-retush')),
     'simple', 'Простая ретушь', 'Ретушь лица, цветокоррекция, чистый фон', 'auto_fix_normal', '#5f7c69',
     490, 490, 490,
     '["Ретушь лица", "Цветокоррекция", "Чистый фон"]'::jsonb,
     false, 590, 17, 1),

    ((SELECT id FROM option_groups WHERE slug = 'retouching' AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'voennaya-retush')),
     'artistic', 'Художественная ретушь', 'Глубокая ретушь, художественный свет, детализация', 'auto_fix_high', '#4f6f7f',
     790, 790, 790,
     '["Глубокая ретушь лица", "Художественный свет", "Детализация и цвет"]'::jsonb,
     true, 990, 20, 2),

    ((SELECT id FROM option_groups WHERE slug = 'retouching' AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'voennaya-retush')),
     'restoration', 'Реставрация + ретушь', 'Восстановление старого или повреждённого фото', 'healing', '#6a5f8f',
     1290, 1290, 1290,
     '["Восстановление повреждений", "Раскрашивание ч/б", "Художественная ретушь"]'::jsonb,
     false, 1590, 19, 3)
ON CONFLICT (option_group_id, slug) DO NOTHING;

-- 5. Options: Форма и атрибутика (multi, optional)
INSERT INTO service_options (option_group_id, slug, name, description, icon, color,
    base_price, price_online, price_studio,
    features, popular, original_price, discount_percent, sort_order)
VALUES
    ((SELECT id FROM option_groups WHERE slug = 'military' AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'voennaya-retush')),
     'uniform', 'Подстановка формы', 'ВДВ, ВМФ, полиция, МЧС и другие варианты', 'checkroom', '#4a7c5f',
     490, 490, 490,
     '["ВДВ, ВМФ, полиция, МЧС", "Натуральная посадка", "Любой род войск"]'::jsonb,
     false, 590, 17, 1),

    ((SELECT id FROM option_groups WHERE slug = 'military' AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'voennaya-retush')),
     'medals', 'Медали и погоны', 'Награды СССР и современные по списку или фото', 'military_tech', '#7c6a4a',
     390, 390, 390,
     '["СССР и современные", "По списку или фото", "Точное расположение"]'::jsonb,
     false, 490, 20, 2),

    ((SELECT id FROM option_groups WHERE slug = 'military' AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'voennaya-retush')),
     'chevrons', 'Шевроны и нашивки', 'Знаки подразделения, род войск, нарукавные знаки', 'shield', '#5a6a7c',
     190, 190, 190,
     '["Подразделение", "Род войск", "Нарукавные знаки"]'::jsonb,
     false, 290, 34, 3)
ON CONFLICT (option_group_id, slug) DO NOTHING;

-- 6. Options: Дополнительно (multi, optional)
INSERT INTO service_options (option_group_id, slug, name, description, icon, color,
    base_price, price_online, price_studio,
    features, popular, original_price, discount_percent, sort_order)
VALUES
    ((SELECT id FROM option_groups WHERE slug = 'extras' AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'voennaya-retush')),
     'beard-removal', 'Убрать бороду', 'Аккуратное удаление бороды и щетины', 'content_cut', '#7c5a5a',
     290, 290, 290,
     '["Естественный результат", "Профессиональная ретушь"]'::jsonb,
     false, 390, 26, 1),

    ((SELECT id FROM option_groups WHERE slug = 'extras' AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'voennaya-retush')),
     'gift-frame', 'Подарочное оформление', 'Рамка, подпись, дизайн для печати на холсте', 'card_giftcard', '#9b6a4f',
     390, 390, 390,
     '["Рамка «С Днём Победы»", "Дизайн для печати", "Подарочная подача"]'::jsonb,
     false, 490, 20, 2),

    ((SELECT id FROM option_groups WHERE slug = 'extras' AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'voennaya-retush')),
     'extra-format', 'Дополнительный формат', 'Ещё один размер готового фото', 'photo_size_select_large', '#5f6f7f',
     190, 190, 190,
     '["9x12, 4x6, 3x4 и др.", "Личное дело, удостоверение"]'::jsonb,
     false, 290, 34, 3)
ON CONFLICT (option_group_id, slug) DO NOTHING;

-- 7. Options: Скорость (single, optional)
INSERT INTO service_options (option_group_id, slug, name, description, icon, color,
    base_price, price_online, price_studio,
    features, sort_order)
VALUES
    ((SELECT id FROM option_groups WHERE slug = 'speed' AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'voennaya-retush')),
     'normal', 'Обычная (1-2 дня)', 'Стандартное время готовности', 'schedule', '#a8a8a8',
     0, 0, 0,
     '["Готово за 1-2 дня"]'::jsonb, 1),

    ((SELECT id FROM option_groups WHERE slug = 'speed' AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'voennaya-retush')),
     'urgent', 'Срочная (до 12 часов)', 'Приоритетная обработка заказа', 'bolt', '#f093fb',
     490, 490, 490,
     '["Готово до 12 часов", "Приоритетная очередь"]'::jsonb, 2)
ON CONFLICT (option_group_id, slug) DO NOTHING;

-- 8. Rules: шевроны требуют форму
INSERT INTO option_rules (service_category_id, rule_type, source_option_id, target_option_id, description)
SELECT
    (SELECT id FROM service_categories WHERE slug = 'voennaya-retush'),
    'requires',
    (SELECT so.id FROM service_options so JOIN option_groups og ON so.option_group_id = og.id
     WHERE so.slug = 'chevrons' AND og.slug = 'military'
     AND og.service_category_id = (SELECT id FROM service_categories WHERE slug = 'voennaya-retush')),
    (SELECT so.id FROM service_options so JOIN option_groups og ON so.option_group_id = og.id
     WHERE so.slug = 'uniform' AND og.slug = 'military'
     AND og.service_category_id = (SELECT id FROM service_categories WHERE slug = 'voennaya-retush')),
    'Шевроны и нашивки требуют подстановку формы'
WHERE NOT EXISTS (
    SELECT 1 FROM option_rules
    WHERE source_option_id = (SELECT so.id FROM service_options so JOIN option_groups og ON so.option_group_id = og.id
         WHERE so.slug = 'chevrons' AND og.slug = 'military'
         AND og.service_category_id = (SELECT id FROM service_categories WHERE slug = 'voennaya-retush'))
    AND target_option_id = (SELECT so.id FROM service_options so JOIN option_groups og ON so.option_group_id = og.id
         WHERE so.slug = 'uniform' AND og.slug = 'military'
         AND og.service_category_id = (SELECT id FROM service_categories WHERE slug = 'voennaya-retush'))
    AND rule_type = 'requires'
);

-- 9. Rules: медали требуют форму
INSERT INTO option_rules (service_category_id, rule_type, source_option_id, target_option_id, description)
SELECT
    (SELECT id FROM service_categories WHERE slug = 'voennaya-retush'),
    'requires',
    (SELECT so.id FROM service_options so JOIN option_groups og ON so.option_group_id = og.id
     WHERE so.slug = 'medals' AND og.slug = 'military'
     AND og.service_category_id = (SELECT id FROM service_categories WHERE slug = 'voennaya-retush')),
    (SELECT so.id FROM service_options so JOIN option_groups og ON so.option_group_id = og.id
     WHERE so.slug = 'uniform' AND og.slug = 'military'
     AND og.service_category_id = (SELECT id FROM service_categories WHERE slug = 'voennaya-retush')),
    'Медали и погоны требуют подстановку формы'
WHERE NOT EXISTS (
    SELECT 1 FROM option_rules
    WHERE source_option_id = (SELECT so.id FROM service_options so JOIN option_groups og ON so.option_group_id = og.id
         WHERE so.slug = 'medals' AND og.slug = 'military'
         AND og.service_category_id = (SELECT id FROM service_categories WHERE slug = 'voennaya-retush'))
    AND target_option_id = (SELECT so.id FROM service_options so JOIN option_groups og ON so.option_group_id = og.id
         WHERE so.slug = 'uniform' AND og.slug = 'military'
         AND og.service_category_id = (SELECT id FROM service_categories WHERE slug = 'voennaya-retush'))
    AND rule_type = 'requires'
);

COMMIT;
