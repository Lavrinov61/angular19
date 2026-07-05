-- Migration: document_photo_presets
-- Adds slug, face_requirements columns and seeds 5 document photo presets
-- Idempotent: safe to run multiple times

BEGIN;

-- 1. Add slug column
ALTER TABLE print_presets ADD COLUMN IF NOT EXISTS slug VARCHAR(50) UNIQUE;

-- 2. Add face_requirements column (JSONB)
ALTER TABLE print_presets ADD COLUMN IF NOT EXISTS face_requirements JSONB;

-- 3. Set slugs for existing presets (only where slug is NULL to preserve idempotency)
UPDATE print_presets SET slug = 'photo_10x15'       WHERE name = 'Фото 10x15'    AND slug IS NULL;
UPDATE print_presets SET slug = 'photo_10x15_matte' WHERE name = '10x15 матовая' AND slug IS NULL;
UPDATE print_presets SET slug = 'photo_13x18'       WHERE name = 'Фото 13x18'    AND slug IS NULL;
UPDATE print_presets SET slug = 'photo_a4'          WHERE name = 'Фото A4'       AND slug IS NULL;
UPDATE print_presets SET slug = 'doc_a4'            WHERE name = 'Документ A4'   AND slug IS NULL;
UPDATE print_presets SET slug = 'doc_a4_bw'         WHERE name = 'A4 Ч/Б'        AND slug IS NULL;
UPDATE print_presets SET slug = 'doc_a4_duplex'     WHERE name = 'Двусторонний'  AND slug IS NULL;
UPDATE print_presets SET slug = 'sublimation'       WHERE name = 'Сублимация'    AND slug IS NULL;

-- 4. Seed 5 document photo presets
INSERT INTO print_presets (id, slug, name, icon, printer_type, sublimation, paper_size, media_type, quality, fit_mode, borderless, color_mode, duplex, mirror, price, sort_order, is_active, rendering_intent, face_requirements)
VALUES
  (gen_random_uuid(), 'passport_35x45',       'Паспорт РФ 35×45',    'badge',          'photo', false, '10x15', 'glossy', 'photo', 'fill', false, 'color', false, false, 350, 10, true, 'absolute_colorimetric', '{"min_mm":30,"max_mm":34,"standard":"ГОСТ Р ИСО/МЭК 19794-5"}'),
  (gen_random_uuid(), 'zagran_35x45',         'Загранпаспорт 35×45', 'flight_takeoff', 'photo', false, '10x15', 'glossy', 'photo', 'fill', false, 'color', false, false, 350, 11, true, 'absolute_colorimetric', '{"min_mm":30,"max_mm":34,"standard":"ГОСТ Р ИСО/МЭК 19794-5"}'),
  (gen_random_uuid(), 'schengen_35x45',       'Виза Шенген 35×45',   'public',         'photo', false, '10x15', 'glossy', 'photo', 'fill', false, 'color', false, false, 350, 12, true, 'absolute_colorimetric', '{"min_mm":32,"max_mm":36,"standard":"ICAO 9303"}'),
  (gen_random_uuid(), 'visa_us_50x50',        'Виза США 50×50',      'flag',           'photo', false, '10x15', 'glossy', 'photo', 'fill', false, 'color', false, false, 350, 13, true, 'absolute_colorimetric', '{"min_mm":25,"max_mm":35,"standard":"US DOS"}'),
  (gen_random_uuid(), 'driver_license_30x40', 'Водительское 30×40',  'directions_car', 'photo', false, '10x15', 'glossy', 'photo', 'fill', false, 'color', false, false, 300, 14, true, 'absolute_colorimetric', '{"min_mm":25,"max_mm":30}')
ON CONFLICT (slug) DO NOTHING;

-- 5. Index on slug
CREATE INDEX IF NOT EXISTS idx_print_presets_slug ON print_presets(slug) WHERE slug IS NOT NULL;

COMMIT;
