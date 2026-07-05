-- ============================================================================
-- Product Specifications — Справочник параметров продукции типографий
-- v0.46.0, 2026-02-28
-- ============================================================================

-- Таблица справочника
CREATE TABLE IF NOT EXISTS product_reference_data (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ref_type       VARCHAR(50) NOT NULL,        -- paper_type, size, binding, cover, lamination, page_thickness, stretcher, decor, material
    ref_key        VARCHAR(50) NOT NULL,        -- glossy, 20x30, hardcover, image_wrap, etc.
    display_name   VARCHAR(100) NOT NULL,       -- "Глянцевая", "20×30 см", "Твёрдая обложка"
    category_scope TEXT[] NOT NULL DEFAULT '{}', -- пустой массив = применимо ко всем категориям
    metadata       JSONB NOT NULL DEFAULT '{}', -- { width_mm, height_mm, gsm, thickness_mm, ... }
    sort_order     INTEGER NOT NULL DEFAULT 0,
    is_active      BOOLEAN NOT NULL DEFAULT true,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (ref_type, ref_key)
);

CREATE INDEX IF NOT EXISTS idx_prd_type ON product_reference_data (ref_type);
CREATE INDEX IF NOT EXISTS idx_prd_type_active ON product_reference_data (ref_type, is_active);
CREATE INDEX IF NOT EXISTS idx_prd_scope ON product_reference_data USING GIN (category_scope);

-- ============================================================================
-- Seed: Справочные данные на основе реальных каталогов РФ производителей
-- (ФотоФиера, RHINODESIGN, Фабрика Фотокниги, LibraryPhoto)
-- ============================================================================

INSERT INTO product_reference_data (ref_type, ref_key, display_name, category_scope, metadata, sort_order) VALUES

-- ---------------------------------------------------------------------------
-- Плотность бумаги (paper_weight) — ФотоФиера каталог
-- ---------------------------------------------------------------------------
('paper_weight', '170g',  '170 г/м²',            '{}', '{"gsm": 170}', 10),
('paper_weight', '200g',  '200 г/м²',            '{}', '{"gsm": 200}', 20),
('paper_weight', '250g',  '250 г/м²',            '{}', '{"gsm": 250}', 30),
('paper_weight', '300g',  '300 г/м² (прокладка)', '{"photo_book","graduation_album"}', '{"gsm": 300, "page_thickness_mm": 1.0}', 40),
('paper_weight', '600g',  '600 г/м² (прокладка)', '{"photo_book","graduation_album"}', '{"gsm": 600, "page_thickness_mm": 1.4}', 50),

-- ---------------------------------------------------------------------------
-- Тип фотобумаги (paper_type) — Fuji / Kodak / Konica
-- ---------------------------------------------------------------------------
('paper_type', 'glossy',        'Глянцевая',            '{}', '{}', 10),
('paper_type', 'matte',         'Матовая',              '{}', '{}', 20),
('paper_type', 'lustra',        'Люстра (полуглянец)',  '{}', '{}', 30),
('paper_type', 'silk',          'Шёлк',                '{}', '{}', 40),
('paper_type', 'pearl',         'Перламутровая',        '{}', '{}', 50),
('paper_type', 'deep_matte',    'Deep Matte',           '{}', '{}', 60),
('paper_type', 'matte_coated',  'Мелованная матовая',   '{"calendar","polygraphy","large_format"}', '{}', 70),
('paper_type', 'glossy_coated', 'Мелованная глянцевая', '{"calendar","polygraphy","large_format"}', '{}', 80),

-- ---------------------------------------------------------------------------
-- Размеры (size) — стандарты РФ по категориям
-- ---------------------------------------------------------------------------

-- Фотопечать
('size', '9x13',   '9×13 см',   '{"photo_print"}',                    '{"width_mm":89,"height_mm":127}',   10),
('size', '10x15',  '10×15 см',  '{"photo_print"}',                    '{"width_mm":102,"height_mm":152}',  20),
('size', '13x18',  '13×18 см',  '{"photo_print"}',                    '{"width_mm":127,"height_mm":178}',  30),
('size', '15x20',  '15×20 см',  '{"photo_print"}',                    '{"width_mm":152,"height_mm":203}',  40),
('size', '15x21',  '15×21 см',  '{"photo_print"}',                    '{"width_mm":152,"height_mm":216}',  50),
('size', '20x30',  '20×30 см',  '{"photo_print","canvas","photo_book"}','{"width_mm":203,"height_mm":305}', 60),
('size', '30x40',  '30×40 см',  '{"photo_print","canvas"}',           '{"width_mm":305,"height_mm":406}',  70),
('size', '30x45',  '30×45 см',  '{"photo_print","canvas"}',           '{"width_mm":305,"height_mm":457}',  80),
('size', '30x60',  '30×60 см',  '{"photo_print","canvas"}',           '{"width_mm":305,"height_mm":610}',  90),
('size', '30x90',  '30×90 см',  '{"photo_print","canvas"}',           '{"width_mm":305,"height_mm":914}', 100),

-- Фотокниги (ФотоФиера Indibook + стандартные)
('size', '16x23',  '16×23 см',  '{"photo_book"}',                     '{"width_mm":160,"height_mm":230}', 110),
('size', '21x30',  '21×30 см',  '{"photo_book","graduation_album","calendar"}', '{"width_mm":210,"height_mm":300}', 120),
('size', '23x23',  '23×23 см',  '{"photo_book","graduation_album"}',  '{"width_mm":230,"height_mm":230}', 130),
('size', '15x15',  '15×15 см',  '{"photo_book"}',                     '{"width_mm":150,"height_mm":150}', 140),
('size', '20x20',  '20×20 см',  '{"photo_book","graduation_album"}',  '{"width_mm":200,"height_mm":200}', 150),
('size', '25x25',  '25×25 см',  '{"photo_book","graduation_album"}',  '{"width_mm":250,"height_mm":250}', 160),
('size', '30x20',  '30×20 см',  '{"photo_book","graduation_album"}',  '{"width_mm":300,"height_mm":200}', 170),
('size', '30x30',  '30×30 см',  '{"photo_book","graduation_album"}',  '{"width_mm":300,"height_mm":300}', 180),
('size', '30x40b', '30×40 см',  '{"photo_book","graduation_album"}',  '{"width_mm":300,"height_mm":400}', 190),

-- Холсты
('size', '20x30c', '20×30 см',  '{"canvas"}',  '{"width_mm":200,"height_mm":300}', 210),
('size', '30x40c', '30×40 см',  '{"canvas"}',  '{"width_mm":300,"height_mm":400}', 220),
('size', '40x50',  '40×50 см',  '{"canvas"}',  '{"width_mm":400,"height_mm":500}', 230),
('size', '40x60',  '40×60 см',  '{"canvas"}',  '{"width_mm":400,"height_mm":600}', 240),
('size', '50x70',  '50×70 см',  '{"canvas"}',  '{"width_mm":500,"height_mm":700}', 250),
('size', '60x80',  '60×80 см',  '{"canvas"}',  '{"width_mm":600,"height_mm":800}', 260),
('size', '60x90',  '60×90 см',  '{"canvas"}',  '{"width_mm":600,"height_mm":900}', 270),
('size', '70x100', '70×100 см', '{"canvas"}',  '{"width_mm":700,"height_mm":1000}',280),
('size', '80x120', '80×120 см', '{"canvas"}',  '{"width_mm":800,"height_mm":1200}',290),

-- Широкоформат
('size', 'A3',  'А3',  '{"large_format","calendar"}', '{"width_mm":297,"height_mm":420}', 310),
('size', 'A2',  'А2',  '{"large_format"}',            '{"width_mm":420,"height_mm":594}', 320),
('size', 'A1',  'А1',  '{"large_format"}',            '{"width_mm":594,"height_mm":841}', 330),
('size', 'A0',  'А0',  '{"large_format"}',            '{"width_mm":841,"height_mm":1189}',340),

-- Календари
('size', 'A5',  'А5',  '{"calendar"}', '{"width_mm":148,"height_mm":210}', 350),

-- ---------------------------------------------------------------------------
-- Переплёт (binding)
-- ---------------------------------------------------------------------------
('binding', 'softcover',     'Мягкая обложка',              '{"photo_book"}',                              '{}', 10),
('binding', 'hardcover',     'Твёрдая обложка',             '{"photo_book","graduation_album"}',           '{}', 20),
('binding', 'layflat',       'LayFlat (раскладка 180°)',    '{"photo_book","graduation_album"}',           '{"extra_days": 2}', 30),
('binding', 'flexbind',      'FlexBind',                    '{"photo_book"}',                              '{}', 40),
('binding', 'pur',           'PUR-клей',                    '{"photo_book","polygraphy"}',                 '{}', 50),
('binding', 'saddle_stitch', 'Скрепка (брошюра)',           '{"calendar","polygraphy"}',                   '{}', 60),
('binding', 'wire_o',        'Пружина Wire-O',              '{"calendar"}',                                '{}', 70),

-- ---------------------------------------------------------------------------
-- Тип обложки (cover)
-- ---------------------------------------------------------------------------
('cover', 'image_wrap',        'Фотообложка',           '{"photo_book","graduation_album"}', '{}', 10),
('cover', 'soft_image_wrap',   'Мягкая фотообложка',    '{"photo_book"}',                   '{}', 20),
('cover', 'faux_leather',      'Экокожа',               '{"photo_book","graduation_album"}', '{}', 30),
('cover', 'natural_leather',   'Натуральная кожа',      '{"photo_book","graduation_album"}', '{"extra_days": 3}', 40),
('cover', 'linen',             'Ткань (лён)',            '{"photo_book","graduation_album"}', '{}', 50),
('cover', 'velvet',            'Ткань (бархат)',         '{"photo_book","graduation_album"}', '{}', 60),
('cover', 'designer_cardboard','Дизайнерский картон',   '{"photo_book"}',                   '{}', 70),
('cover', 'foil_stamping',     'Тиснение фольгой',      '{"photo_book","graduation_album"}', '{"extra_days": 1}', 80),
('cover', 'diecut_window',     'Вырубное окно',         '{"photo_book","graduation_album"}', '{"extra_days": 1}', 90),
('cover', 'metal_nameplate',   'Шильд (металлическая пластина)', '{"photo_book","graduation_album"}', '{"extra_days": 2}', 100),

-- ---------------------------------------------------------------------------
-- Ламинация (lamination) — ФотоФиера + стандарт
-- ---------------------------------------------------------------------------
('lamination', 'glossy_lam',    'Глянцевая ламинация',          '{}', '{}', 10),
('lamination', 'matte_lam',     'Матовая ламинация',            '{}', '{}', 20),
('lamination', 'textured',      'Фактурная (мелкозернистая)',   '{}', '{}', 30),
('lamination', 'pearl_lam',     'Перламутровая ламинация',      '{}', '{}', 40),
('lamination', 'uv_spot',       'УФ-лак (выборочный)',          '{"photo_book","graduation_album","polygraphy"}', '{"extra_days": 1}', 50),

-- ---------------------------------------------------------------------------
-- Толщина страниц (page_thickness) — ФотоФиера Indibook
-- ---------------------------------------------------------------------------
('page_thickness', '0.6mm', '0.6 мм (склейка корешок-к-корешку)', '{"photo_book"}', '{"thickness_mm": 0.6}', 10),
('page_thickness', '1.0mm', '1.0 мм (прокладка 300 г/м²)',        '{"photo_book"}', '{"thickness_mm": 1.0, "insert_gsm": 300}', 20),
('page_thickness', '1.4mm', '1.4 мм (прокладка 600 г/м²)',        '{"photo_book"}', '{"thickness_mm": 1.4, "insert_gsm": 600}', 30),

-- ---------------------------------------------------------------------------
-- Подрамник холста (stretcher)
-- ---------------------------------------------------------------------------
('stretcher', 'standard_2cm', 'Стандарт 2 см',    '{"canvas"}', '{"thickness_mm": 20}', 10),
('stretcher', 'gallery_35cm', 'Галерейный 3.5 см', '{"canvas"}', '{"thickness_mm": 35}', 20),

-- ---------------------------------------------------------------------------
-- Декор / доп. опции (decor)
-- ---------------------------------------------------------------------------
('decor', 'metal_corners',  'Металлические уголки',  '{"photo_book","graduation_album"}', '{}', 10),
('decor', 'edge_stitching', 'Краевая прошивка',      '{"photo_book","graduation_album"}', '{}', 20),
('decor', 'bookmark',       'Ленточка-закладка',     '{"photo_book","graduation_album"}', '{"min_spreads": 7}', 30),
('decor', 'custom_stamping','Кастомное тиснение',    '{"photo_book","graduation_album"}', '{"extra_days": 2}', 40),
('decor', 'photo_insert',   'Фотовставка на обложку','{"photo_book","graduation_album"}', '{}', 50),

-- ---------------------------------------------------------------------------
-- Материал сувениров (material)
-- ---------------------------------------------------------------------------
('material', 'ceramic',  'Керамика', '{"souvenir"}', '{}', 10),
('material', 'glass',    'Стекло',   '{"souvenir"}', '{}', 20),
('material', 'textile',  'Текстиль', '{"souvenir"}', '{}', 30),
('material', 'metal',    'Металл',   '{"souvenir"}', '{}', 40),
('material', 'wood',     'Дерево',   '{"souvenir"}', '{}', 50),
('material', 'plastic',  'Пластик',  '{"souvenir"}', '{}', 60)

ON CONFLICT (ref_type, ref_key) DO UPDATE SET
    display_name   = EXCLUDED.display_name,
    category_scope = EXCLUDED.category_scope,
    metadata       = EXCLUDED.metadata,
    sort_order     = EXCLUDED.sort_order;

-- ============================================================================
-- Миграция: перенос существующих данных из available_formats / available_materials
-- в options JSONB (для уже созданных продуктов)
-- ============================================================================

-- Переносим available_formats → options.sizes (только если options.sizes ещё нет)
UPDATE printing_house_products
SET options = options || jsonb_build_object('sizes', to_jsonb(available_formats))
WHERE array_length(available_formats, 1) > 0
  AND NOT (options ? 'sizes');

-- Переносим available_materials → options.papers (только если options.papers ещё нет)
UPDATE printing_house_products
SET options = options || jsonb_build_object('papers', to_jsonb(available_materials))
WHERE array_length(available_materials, 1) > 0
  AND NOT (options ? 'papers');

-- ============================================================================
-- Обновление seed printing_houses — актуализируем ФотоФиера
-- ============================================================================

UPDATE printing_houses
SET
    address         = 'г. Ростов-на-Дону, ул. Орская, 14е к.1',
    website         = 'https://fotofiera.ru',
    notes           = 'Производство HP Indigo + Noritsu QSS-3702HD + Ricoh. Уникальная 6-цветная печать (CMYK + Light Cyan + Light Magenta). Выпускные альбомы — специализация.',
    capabilities    = ARRAY['photo_book','graduation_album','calendar','photo_print','polygraphy']
WHERE code = 'fotofiera';
