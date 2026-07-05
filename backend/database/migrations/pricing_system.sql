-- Unified Pricing System Migration
-- Replaces hardcoded service-pricing.ts with DB-driven configurator model
-- Единый источник правды для ценообразования: сайт, чат-бот, POS, CRM

-- ========================================
-- КАТЕГОРИИ УСЛУГ
-- ========================================

CREATE TABLE IF NOT EXISTS service_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    icon VARCHAR(50),
    gradient VARCHAR(255),
    image_url VARCHAR(500),
    price_range VARCHAR(50),
    display_channels TEXT[] DEFAULT '{website,chatbot,pos}',
    sort_order INT DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_service_categories_slug ON service_categories(slug);
CREATE INDEX IF NOT EXISTS idx_service_categories_active ON service_categories(is_active, sort_order);

-- ========================================
-- ГРУППЫ ОПЦИЙ
-- ========================================

CREATE TABLE IF NOT EXISTS option_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_category_id UUID NOT NULL REFERENCES service_categories(id) ON DELETE CASCADE,
    slug VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    selection_type VARCHAR(20) NOT NULL DEFAULT 'single'
        CHECK (selection_type IN ('single', 'multi', 'quantity')),
    is_required BOOLEAN DEFAULT false,
    min_selections INT DEFAULT 0,
    max_selections INT DEFAULT 1,
    sort_order INT DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(service_category_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_option_groups_category ON option_groups(service_category_id);

-- ========================================
-- АТОМАРНЫЕ ОПЦИИ С ЦЕНАМИ
-- ========================================

CREATE TABLE IF NOT EXISTS service_options (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    option_group_id UUID NOT NULL REFERENCES option_groups(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    slug VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    icon VARCHAR(50),
    color VARCHAR(20),

    -- Ценообразование (multi-channel)
    base_price DECIMAL(10,2) NOT NULL,
    price_online DECIMAL(10,2),
    price_studio DECIMAL(10,2),
    price_next_unit DECIMAL(10,2),
    price_max DECIMAL(10,2),

    -- Промо «первый заказ»
    promo_first_price DECIMAL(10,2),
    promo_description VARCHAR(255),

    -- Отображение на витрине
    features JSONB DEFAULT '[]',
    popular BOOLEAN DEFAULT false,
    original_price DECIMAL(10,2),
    discount_percent INT,

    sort_order INT DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(option_group_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_service_options_group ON service_options(option_group_id);
CREATE INDEX IF NOT EXISTS idx_service_options_product ON service_options(product_id) WHERE product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_service_options_active ON service_options(is_active);

-- ========================================
-- ПРАВИЛА СОВМЕСТИМОСТИ ОПЦИЙ
-- ========================================

CREATE TABLE IF NOT EXISTS option_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_category_id UUID NOT NULL REFERENCES service_categories(id) ON DELETE CASCADE,
    rule_type VARCHAR(20) NOT NULL
        CHECK (rule_type IN ('requires', 'excludes', 'includes', 'price_override')),
    source_option_id UUID NOT NULL REFERENCES service_options(id) ON DELETE CASCADE,
    target_option_id UUID NOT NULL REFERENCES service_options(id) ON DELETE CASCADE,
    override_price DECIMAL(10,2),
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(source_option_id, target_option_id, rule_type)
);
CREATE INDEX IF NOT EXISTS idx_option_rules_category ON option_rules(service_category_id);
CREATE INDEX IF NOT EXISTS idx_option_rules_source ON option_rules(source_option_id);
CREATE INDEX IF NOT EXISTS idx_option_rules_target ON option_rules(target_option_id);

-- ========================================
-- МОДИФИКАТОРЫ ЦЕН (на будущее)
-- ========================================

CREATE TABLE IF NOT EXISTS price_modifiers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    modifier_type VARCHAR(30) NOT NULL
        CHECK (modifier_type IN ('channel', 'seasonal', 'time_of_day', 'volume', 'customer_segment')),
    scope VARCHAR(30) NOT NULL DEFAULT 'global'
        CHECK (scope IN ('global', 'category', 'option')),
    service_category_id UUID REFERENCES service_categories(id) ON DELETE CASCADE,
    service_option_id UUID REFERENCES service_options(id) ON DELETE CASCADE,
    modifier_action VARCHAR(20) NOT NULL DEFAULT 'multiply'
        CHECK (modifier_action IN ('multiply', 'add', 'subtract', 'override')),
    modifier_value DECIMAL(10,4) NOT NULL,
    conditions JSONB DEFAULT '{}',
    priority INT DEFAULT 0,
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_price_modifiers_active ON price_modifiers(is_active, modifier_type);
CREATE INDEX IF NOT EXISTS idx_price_modifiers_category ON price_modifiers(service_category_id);
CREATE INDEX IF NOT EXISTS idx_price_modifiers_option ON price_modifiers(service_option_id);

-- ========================================
-- АУДИТ ЦЕНОВЫХ ИЗМЕНЕНИЙ
-- ========================================

CREATE TABLE IF NOT EXISTS pricing_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type VARCHAR(30) NOT NULL,
    entity_id UUID NOT NULL,
    changed_by UUID,
    old_values JSONB NOT NULL,
    new_values JSONB NOT NULL,
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pricing_snapshots_entity ON pricing_snapshots(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_pricing_snapshots_date ON pricing_snapshots(created_at DESC);

-- ========================================
-- SEED: Фото на документы
-- ========================================

-- Категория
INSERT INTO service_categories (slug, name, description, icon, gradient, price_range, display_channels, sort_order)
VALUES (
    'photo-docs',
    'Фото на документы',
    'Профессиональное фото на документы с обработкой',
    'photo_camera',
    'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    'от 100₽',
    '{website,chatbot,pos}',
    1
)
ON CONFLICT (slug) DO NOTHING;

-- Группы опций
INSERT INTO option_groups (service_category_id, slug, name, description, selection_type, is_required, max_selections, sort_order)
VALUES
    ((SELECT id FROM service_categories WHERE slug = 'photo-docs'),
     'processing-level', 'Уровень обработки', 'Выберите тип обработки фотографии', 'single', true, 1, 1),
    ((SELECT id FROM service_categories WHERE slug = 'photo-docs'),
     'speed', 'Скорость', 'Время готовности заказа', 'single', false, 1, 2),
    ((SELECT id FROM service_categories WHERE slug = 'photo-docs'),
     'extras', 'Дополнения', 'Дополнительные опции к заказу', 'multi', false, 10, 3)
ON CONFLICT (service_category_id, slug) DO NOTHING;

-- Опции: Уровень обработки
INSERT INTO service_options (option_group_id, slug, name, description, icon, color,
    base_price, price_online, price_studio, price_next_unit,
    promo_first_price, promo_description,
    features, popular, original_price, discount_percent, sort_order)
VALUES
    -- Без обработки
    ((SELECT id FROM option_groups WHERE slug = 'processing-level' AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'photo-docs')),
     'basic', 'Без обработки', 'Фото без ретуши, быстрый вариант', 'photo_camera', '#43e97b',
     350, 350, 700, 350,
     100, 'Первый заказ',
     '["Замена фона на белый", "Комплект 4–6 фото", "Готово за 30 минут"]'::jsonb,
     false, 400, 16, 1),
    -- С обработкой
    ((SELECT id FROM option_groups WHERE slug = 'processing-level' AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'photo-docs')),
     'retouch', 'С обработкой', 'Ретушь кожи, причёски, цветокоррекция', 'auto_fix_high', '#667eea',
     700, 590, 700, 590,
     NULL, NULL,
     '["Обработка кожи и причёски", "Комплект 4–6 фото", "2-й вариант в подарок"]'::jsonb,
     true, 700, 16, 2),
    -- VIP
    ((SELECT id FROM option_groups WHERE slug = 'processing-level' AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'photo-docs')),
     'vip', 'VIP-обработка', 'Премиальная обработка, 4 варианта', 'diamond', '#f7c948',
     700, 950, 700, 950,
     NULL, NULL,
     '["4 варианта обработки", "Премиальное качество"]'::jsonb,
     false, 1100, 14, 3)
ON CONFLICT (option_group_id, slug) DO NOTHING;

-- Опции: Скорость
INSERT INTO service_options (option_group_id, slug, name, description, icon, color,
    base_price, price_online, price_studio, features, sort_order)
VALUES
    ((SELECT id FROM option_groups WHERE slug = 'speed' AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'photo-docs')),
     'normal', 'Обычная (30 мин)', 'Стандартное время готовности', 'schedule', '#a8a8a8',
     0, 0, 0, '["Готово за 30 минут"]'::jsonb, 1),
    ((SELECT id FROM option_groups WHERE slug = 'speed' AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'photo-docs')),
     'urgent', 'Срочная (10–15 мин)', 'Ускоренная обработка заказа', 'bolt', '#f093fb',
     160, 160, 160, '["Готово за 10–15 минут"]'::jsonb, 2)
ON CONFLICT (option_group_id, slug) DO NOTHING;

-- Опции: Дополнения
INSERT INTO service_options (option_group_id, slug, name, description, icon, color,
    base_price, price_online, price_studio, features, sort_order)
VALUES
    ((SELECT id FROM option_groups WHERE slug = 'extras' AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'photo-docs')),
     'uniform', 'Подстановка формы', 'Подстановка военной, полицейской или другой формы', 'military_tech', '#fa709a',
     160, 160, 160, '["Военная, полиция, МЧС и др."]'::jsonb, 1),
    ((SELECT id FROM option_groups WHERE slug = 'extras' AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'photo-docs')),
     'all-docs-bundle', 'На все документы (4 комплекта)', '4 комплекта на разные документы', 'folder_copy', '#764ba2',
     300, 300, 300, '["Паспорт, загран, права, виза"]'::jsonb, 2),
    ((SELECT id FROM option_groups WHERE slug = 'extras' AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'photo-docs')),
     'print-delivery', 'Печать + доставка', 'Печать фото и доставка по городу', 'local_shipping', '#4facfe',
     200, 200, 200, '["Печать на фотобумаге", "Доставка по городу"]'::jsonb, 3)
ON CONFLICT (option_group_id, slug) DO NOTHING;

-- Правила совместимости
-- uniform requires retouch или vip (нельзя подставить форму без обработки)
INSERT INTO option_rules (service_category_id, rule_type, source_option_id, target_option_id, description)
SELECT
    (SELECT id FROM service_categories WHERE slug = 'photo-docs'),
    'requires',
    (SELECT so.id FROM service_options so JOIN option_groups og ON so.option_group_id = og.id WHERE so.slug = 'uniform' AND og.slug = 'extras'),
    (SELECT so.id FROM service_options so JOIN option_groups og ON so.option_group_id = og.id WHERE so.slug = 'retouch' AND og.slug = 'processing-level'),
    'Подстановка формы требует обработку (С обработкой или VIP)'
WHERE NOT EXISTS (
    SELECT 1 FROM option_rules WHERE source_option_id = (SELECT so.id FROM service_options so JOIN option_groups og ON so.option_group_id = og.id WHERE so.slug = 'uniform' AND og.slug = 'extras')
    AND target_option_id = (SELECT so.id FROM service_options so JOIN option_groups og ON so.option_group_id = og.id WHERE so.slug = 'retouch' AND og.slug = 'processing-level')
    AND rule_type = 'requires'
);

-- urgent excludes basic
INSERT INTO option_rules (service_category_id, rule_type, source_option_id, target_option_id, description)
SELECT
    (SELECT id FROM service_categories WHERE slug = 'photo-docs'),
    'excludes',
    (SELECT so.id FROM service_options so JOIN option_groups og ON so.option_group_id = og.id WHERE so.slug = 'urgent' AND og.slug = 'speed'),
    (SELECT so.id FROM service_options so JOIN option_groups og ON so.option_group_id = og.id WHERE so.slug = 'basic' AND og.slug = 'processing-level'),
    'Срочное фото не совместимо с вариантом без обработки'
WHERE NOT EXISTS (
    SELECT 1 FROM option_rules WHERE source_option_id = (SELECT so.id FROM service_options so JOIN option_groups og ON so.option_group_id = og.id WHERE so.slug = 'urgent' AND og.slug = 'speed')
    AND target_option_id = (SELECT so.id FROM service_options so JOIN option_groups og ON so.option_group_id = og.id WHERE so.slug = 'basic' AND og.slug = 'processing-level')
    AND rule_type = 'excludes'
);

-- ========================================
-- SEED: Нейрофотосессия
-- ========================================

INSERT INTO service_categories (slug, name, description, icon, gradient, price_range, display_channels, sort_order)
VALUES (
    'neuro-photo',
    'Нейрофотосессия',
    'AI-генерация фотографий на основе вашего лица',
    'psychology',
    'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    'от 450₽',
    '{website,chatbot}',
    2
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO option_groups (service_category_id, slug, name, description, selection_type, is_required, max_selections, sort_order)
VALUES
    ((SELECT id FROM service_categories WHERE slug = 'neuro-photo'),
     'package', 'Пакет', 'Выберите количество фотографий', 'single', true, 1, 1)
ON CONFLICT (service_category_id, slug) DO NOTHING;

INSERT INTO service_options (option_group_id, slug, name, description, icon, color,
    base_price, price_online, price_studio, features, sort_order)
VALUES
    ((SELECT id FROM option_groups WHERE slug = 'package' AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'neuro-photo')),
     'neuro-mini', 'Мини (1 фото)', '1 AI-фотография', 'psychology', '#f093fb',
     450, 450, 450, '["1 фото в выбранном стиле"]'::jsonb, 1),
    ((SELECT id FROM option_groups WHERE slug = 'package' AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'neuro-photo')),
     'neuro-standard', 'Стандарт (4 фото)', '4 AI-фотографии', 'collections', '#764ba2',
     990, 990, 990, '["4 фото в разных стилях"]'::jsonb, 2),
    ((SELECT id FROM option_groups WHERE slug = 'package' AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'neuro-photo')),
     'neuro-full', 'Полная (10–15 фото)', '10–15 AI-фотографий', 'auto_awesome', '#667eea',
     3000, 3000, 3000, '["10–15 фото в разных стилях", "Премиум качество"]'::jsonb, 3)
ON CONFLICT (option_group_id, slug) DO NOTHING;

-- ========================================
-- SEED: Реставрация фото
-- ========================================

INSERT INTO service_categories (slug, name, description, icon, gradient, price_range, display_channels, sort_order)
VALUES (
    'photo-restore',
    'Реставрация фото',
    'Восстановление старых и повреждённых фотографий',
    'healing',
    'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
    'от 450₽',
    '{website,chatbot}',
    3
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO option_groups (service_category_id, slug, name, description, selection_type, is_required, max_selections, sort_order)
VALUES
    ((SELECT id FROM service_categories WHERE slug = 'photo-restore'),
     'complexity', 'Сложность', 'Выберите уровень сложности реставрации', 'single', true, 1, 1)
ON CONFLICT (service_category_id, slug) DO NOTHING;

INSERT INTO service_options (option_group_id, slug, name, description, icon, color,
    base_price, price_online, price_studio, features, sort_order)
VALUES
    ((SELECT id FROM option_groups WHERE slug = 'complexity' AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'photo-restore')),
     'restore-simple', 'Простая реставрация', 'Мелкие повреждения, царапины', 'healing', '#a8edea',
     450, 450, 450, '["Устранение царапин", "Коррекция цвета"]'::jsonb, 1),
    ((SELECT id FROM option_groups WHERE slug = 'complexity' AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'photo-restore')),
     'restore-medium', 'Средняя сложность', 'Значительные повреждения', 'auto_fix_high', '#fed6e3',
     900, 900, 900, '["Восстановление утраченных фрагментов", "Улучшение качества"]'::jsonb, 2),
    ((SELECT id FROM option_groups WHERE slug = 'complexity' AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'photo-restore')),
     'restore-complex', 'Сложная реставрация', 'Серьёзные повреждения, утраты', 'construction', '#f5576c',
     1800, 1800, 1800, '["Полное восстановление", "Колоризация по запросу"]'::jsonb, 3)
ON CONFLICT (option_group_id, slug) DO NOTHING;
