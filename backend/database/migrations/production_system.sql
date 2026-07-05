-- ================================================================
-- Production System (Управление типографиями и производственными заказами)
-- ================================================================

-- 1. Справочник типографий
CREATE TABLE IF NOT EXISTS printing_houses (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                VARCHAR(255) NOT NULL,
    code                VARCHAR(50)  UNIQUE NOT NULL,
    status              VARCHAR(20)  NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'inactive', 'testing')),
    contact_name        VARCHAR(255),
    contact_phone       VARCHAR(30),
    contact_email       VARCHAR(255),
    website             VARCHAR(500),
    address             TEXT,
    notes               TEXT,
    -- Способ взаимодействия (manual = вручную, api = автоматически, email = по email)
    api_type            VARCHAR(50)  NOT NULL DEFAULT 'manual'
                        CHECK (api_type IN ('manual', 'api', 'email')),
    api_config          JSONB        NOT NULL DEFAULT '{}',
    -- Возможности типографии
    capabilities        TEXT[]       NOT NULL DEFAULT '{}',
    delivery_zones      TEXT[]       NOT NULL DEFAULT '{}',
    min_order_amount    DECIMAL(10,2) NOT NULL DEFAULT 0,
    -- Агрегированные метрики качества (пересчитываются при изменении статуса заказа)
    quality_score       DECIMAL(3,2) NOT NULL DEFAULT 0,
    on_time_rate        DECIMAL(5,2) NOT NULL DEFAULT 0,
    defect_rate         DECIMAL(5,2) NOT NULL DEFAULT 0,
    total_orders        INTEGER      NOT NULL DEFAULT 0,
    total_spent         DECIMAL(12,2) NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_printing_houses_status ON printing_houses(status);
CREATE INDEX IF NOT EXISTS idx_printing_houses_capabilities ON printing_houses USING GIN(capabilities);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_printing_houses_updated_at') THEN
    CREATE TRIGGER update_printing_houses_updated_at
      BEFORE UPDATE ON printing_houses
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- 2. Каталог продукции каждой типографии
CREATE TABLE IF NOT EXISTS printing_house_products (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    printing_house_id       UUID         NOT NULL REFERENCES printing_houses(id) ON DELETE CASCADE,
    name                    VARCHAR(255) NOT NULL,
    category                VARCHAR(100) NOT NULL,
    sku                     VARCHAR(100),
    description             TEXT,
    base_price              DECIMAL(10,2) NOT NULL,
    price_unit              VARCHAR(30)  NOT NULL DEFAULT 'piece',
    min_quantity            INTEGER      NOT NULL DEFAULT 1,
    available_formats       TEXT[]       NOT NULL DEFAULT '{}',
    available_materials     TEXT[]       NOT NULL DEFAULT '{}',
    options                 JSONB        NOT NULL DEFAULT '{}',
    lead_time_days          INTEGER      NOT NULL DEFAULT 3,
    express_available       BOOLEAN      NOT NULL DEFAULT false,
    express_surcharge_pct   DECIMAL(5,2) NOT NULL DEFAULT 50,
    notes                   TEXT,
    is_active               BOOLEAN      NOT NULL DEFAULT true,
    sort_order              INTEGER      NOT NULL DEFAULT 0,
    created_at              TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_php_house ON printing_house_products(printing_house_id);
CREATE INDEX IF NOT EXISTS idx_php_category ON printing_house_products(category);
CREATE INDEX IF NOT EXISTS idx_php_active ON printing_house_products(printing_house_id, is_active);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_php_updated_at') THEN
    CREATE TRIGGER update_php_updated_at
      BEFORE UPDATE ON printing_house_products
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- 3. Производственные заказы
CREATE TABLE IF NOT EXISTS production_orders (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number            VARCHAR(50)  UNIQUE NOT NULL,
    printing_house_id       UUID         NOT NULL REFERENCES printing_houses(id),
    -- Связь с клиентским заказом (опциональная)
    photo_print_order_id    UUID         REFERENCES photo_print_orders(id) ON DELETE SET NULL,
    customer_id             UUID         REFERENCES customers(id) ON DELETE SET NULL,
    created_by              UUID         NOT NULL REFERENCES users(id),
    status                  VARCHAR(30)  NOT NULL DEFAULT 'draft'
                            CHECK (status IN (
                                'draft', 'pending', 'sent', 'confirmed', 'in_production',
                                'quality_check', 'shipped', 'delivered', 'completed',
                                'cancelled', 'returned'
                            )),
    items                   JSONB        NOT NULL DEFAULT '[]',
    total_cost              DECIMAL(10,2) NOT NULL DEFAULT 0,
    -- Дедлайны
    deadline_at             TIMESTAMPTZ,
    estimated_delivery_at   TIMESTAMPTZ,
    actual_delivery_at      TIMESTAMPTZ,
    -- Логистика
    delivery_method         VARCHAR(50)  NOT NULL DEFAULT 'pickup'
                            CHECK (delivery_method IN ('pickup', 'courier', 'post')),
    tracking_number         VARCHAR(100),
    -- Оценка качества (заполняется после получения)
    quality_rating          INTEGER      CHECK (quality_rating BETWEEN 1 AND 5),
    quality_notes           TEXT,
    has_defects             BOOLEAN      NOT NULL DEFAULT false,
    -- Заметки
    internal_notes          TEXT,
    printing_house_notes    TEXT,
    -- Временные метки переходов статуса
    sent_at                 TIMESTAMPTZ,
    confirmed_at            TIMESTAMPTZ,
    completed_at            TIMESTAMPTZ,
    cancelled_at            TIMESTAMPTZ,
    cancel_reason           TEXT,
    created_at              TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_po_status ON production_orders(status);
CREATE INDEX IF NOT EXISTS idx_po_house ON production_orders(printing_house_id);
CREATE INDEX IF NOT EXISTS idx_po_source ON production_orders(photo_print_order_id) WHERE photo_print_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_po_created ON production_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_po_deadline ON production_orders(deadline_at) WHERE status NOT IN ('completed', 'cancelled', 'returned');

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_production_orders_updated_at') THEN
    CREATE TRIGGER update_production_orders_updated_at
      BEFORE UPDATE ON production_orders
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- 4. Таймлайн событий производственного заказа
CREATE TABLE IF NOT EXISTS production_order_events (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    production_order_id     UUID         NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
    event_type              VARCHAR(50)  NOT NULL,
    old_value               VARCHAR(200),
    new_value               VARCHAR(200),
    comment                 TEXT,
    created_by              UUID         REFERENCES users(id),
    metadata                JSONB        NOT NULL DEFAULT '{}',
    created_at              TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_poe_order ON production_order_events(production_order_id);
CREATE INDEX IF NOT EXISTS idx_poe_created ON production_order_events(created_at);

-- ================================================================
-- Seed: реальные типографии-партнёры
-- ================================================================

INSERT INTO printing_houses (
    code, name, status, contact_phone, website, address,
    api_type, capabilities, delivery_zones, notes
) VALUES
(
    'yarkiy',
    'Яркий Фотомаркет',
    'active',
    '+7 (863) 310-11-18',
    'https://photo.yarkiy.ru/rostov',
    'Ростов-на-Дону, ул. Большая Садовая, 92',
    'manual',
    ARRAY['photo_print','canvas','photo_book','calendar','souvenir','polygraphy','large_format'],
    ARRAY['rostov'],
    'Основной партнёр. Работает на платформе PixlPark (web-to-print). Режим: Пн-Вс 09:00-21:00.'
),
(
    'fotofiera',
    'ФотоФиера',
    'testing',
    NULL,
    'https://fotofiera.ru',
    'Москва',
    'email',
    ARRAY['photo_book','calendar','graduation_album'],
    ARRAY['russia'],
    '6-цветная печать, специализация: выпускные альбомы и фотокниги. Доставка по всей России.'
),
(
    'netprint',
    'NetPrint',
    'inactive',
    NULL,
    'https://netprint.ru',
    'Москва',
    'api',
    ARRAY['photo_print','photo_book','calendar','souvenir'],
    ARRAY['russia'],
    'Федеральный сервис фотопечати. API-интеграция потенциальна в будущем.'
)
ON CONFLICT (code) DO NOTHING;

-- Seed: продукция Яркого Фотомаркета
WITH yarkiy AS (SELECT id FROM printing_houses WHERE code = 'yarkiy')
INSERT INTO printing_house_products (
    printing_house_id, name, category, base_price, price_unit,
    min_quantity, available_formats, available_materials, lead_time_days, sort_order
)
SELECT
    yarkiy.id, p.name, p.category, p.base_price, p.price_unit,
    p.min_quantity, p.available_formats, p.available_materials, p.lead_time_days, p.sort_order
FROM yarkiy, (VALUES
    ('Фотопечать 10×15', 'photo_print', 7, 'piece', 1,
     ARRAY['10x15'], ARRAY['glossy','matte'], 1, 10),
    ('Фотопечать 15×21', 'photo_print', 15, 'piece', 1,
     ARRAY['15x21'], ARRAY['glossy','matte'], 1, 20),
    ('Фотопечать 20×30', 'photo_print', 35, 'piece', 1,
     ARRAY['20x30'], ARRAY['glossy','matte'], 1, 30),
    ('Фотопечать 30×45', 'photo_print', 80, 'piece', 1,
     ARRAY['30x45'], ARRAY['glossy','matte'], 1, 40),
    ('Холст 20×30', 'canvas', 450, 'piece', 1,
     ARRAY['20x30'], ARRAY['canvas'], 3, 50),
    ('Холст 40×60', 'canvas', 850, 'piece', 1,
     ARRAY['40x60'], ARRAY['canvas'], 3, 60),
    ('Холст 60×90', 'canvas', 1400, 'piece', 1,
     ARRAY['60x90'], ARRAY['canvas'], 3, 70),
    ('Фотокнига 20×20 (20 разворотов)', 'photo_book', 1800, 'piece', 1,
     ARRAY['20x20'], ARRAY['glossy','matte'], 5, 80),
    ('Фотокнига 30×30 (20 разворотов)', 'photo_book', 2800, 'piece', 1,
     ARRAY['30x30'], ARRAY['glossy','matte'], 5, 90),
    ('Фотокалендарь А3', 'calendar', 350, 'piece', 1,
     ARRAY['A3'], ARRAY['glossy'], 3, 100),
    ('Фотокалендарь домик А5', 'calendar', 250, 'piece', 1,
     ARRAY['A5'], ARRAY['glossy'], 3, 110),
    ('Кружка с фото', 'souvenir', 450, 'piece', 1,
     ARRAY['330ml'], ARRAY['ceramic'], 2, 120),
    ('Плакат A2', 'large_format', 280, 'piece', 1,
     ARRAY['A2'], ARRAY['glossy','matte'], 2, 130),
    ('Плакат A1', 'large_format', 450, 'piece', 1,
     ARRAY['A1'], ARRAY['glossy','matte'], 2, 140)
) AS p(name, category, base_price, price_unit, min_quantity,
       available_formats, available_materials, lead_time_days, sort_order)
ON CONFLICT DO NOTHING;

-- Seed: продукция ФотоФиера
WITH fotofiera AS (SELECT id FROM printing_houses WHERE code = 'fotofiera')
INSERT INTO printing_house_products (
    printing_house_id, name, category, base_price, price_unit,
    min_quantity, available_formats, available_materials, lead_time_days, sort_order, notes
)
SELECT
    fotofiera.id, p.name, p.category, p.base_price, p.price_unit,
    p.min_quantity, p.available_formats, p.available_materials, p.lead_time_days, p.sort_order, p.notes
FROM fotofiera, (VALUES
    ('Фотокнига 20×20 (6 цветов)', 'photo_book', 2200, 'piece', 1,
     ARRAY['20x20'], ARRAY['glossy','matte'], 7, 10, '6-цветная печать, превосходная цветопередача'),
    ('Выпускной альбом А4 твёрдая обложка', 'graduation_album', 1500, 'piece', 10,
     ARRAY['A4'], ARRAY['glossy','matte'], 10, 20, 'Минимальный тираж 10 шт'),
    ('Фотокалендарь перекидной А3', 'calendar', 380, 'piece', 1,
     ARRAY['A3'], ARRAY['glossy'], 7, 30, NULL)
) AS p(name, category, base_price, price_unit, min_quantity,
       available_formats, available_materials, lead_time_days, sort_order, notes)
ON CONFLICT DO NOTHING;
