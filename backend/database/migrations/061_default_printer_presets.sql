-- Migration 061: Default Printer Presets for Canon C3226i and Epson L8050
-- Idempotent: ON CONFLICT (slug) DO UPDATE

BEGIN;

-- Canon iR-ADV C3226i presets
INSERT INTO print_presets (name, slug, icon, printer_type, paper_size, media_type, quality, fit_mode, borderless, color_mode, duplex, mirror, sublimation, price, sort_order, rendering_intent)
VALUES
  ('А4 Цветная',      'c3226i-a4-color',     'print',       'mfp', 'A4',  'plain',   'normal', 'fit', FALSE, 'color', FALSE, FALSE, FALSE, 15.0,  10, 'relative_colorimetric'),
  ('А4 ч/б',          'c3226i-a4-bw',        'print',       'mfp', 'A4',  'plain',   'normal', 'fit', FALSE, 'bw',    FALSE, FALSE, FALSE, 5.0,   11, 'relative_colorimetric'),
  ('А4 Цвет Дуплекс', 'c3226i-a4-color-dup', 'content_copy','mfp', 'A4',  'plain',   'normal', 'fit', FALSE, 'color', TRUE,  FALSE, FALSE, 25.0,  12, 'relative_colorimetric'),
  ('А4 ч/б Дуплекс',  'c3226i-a4-bw-dup',    'content_copy','mfp', 'A4',  'plain',   'normal', 'fit', FALSE, 'bw',    TRUE,  FALSE, FALSE, 8.0,   13, 'relative_colorimetric'),
  ('А3 Цветная',      'c3226i-a3-color',     'print',       'mfp', 'A3',  'plain',   'normal', 'fit', FALSE, 'color', FALSE, FALSE, FALSE, 30.0,  14, 'relative_colorimetric'),
  ('А3 ч/б',          'c3226i-a3-bw',        'print',       'mfp', 'A3',  'plain',   'normal', 'fit', FALSE, 'bw',    FALSE, FALSE, FALSE, 10.0,  15, 'relative_colorimetric')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name, price = EXCLUDED.price, sort_order = EXCLUDED.sort_order;

-- Epson L8050 presets
INSERT INTO print_presets (name, slug, icon, printer_type, paper_size, media_type, quality, fit_mode, borderless, color_mode, duplex, mirror, sublimation, price, sort_order, rendering_intent, face_requirements)
VALUES
  ('10x15 Фото',       'l8050-10x15',          'photo',  'photo', '10x15', 'glossy',  'photo',  'fill', TRUE,  'color', FALSE, FALSE, FALSE, 10.0,  1, 'perceptual', NULL),
  ('13x18 Фото',       'l8050-13x18',          'photo',  'photo', '13x18', 'glossy',  'photo',  'fill', TRUE,  'color', FALSE, FALSE, FALSE, 25.0,  2, 'perceptual', NULL),
  ('15x21 Фото',       'l8050-15x21',          'photo',  'photo', '15x21', 'glossy',  'photo',  'fill', TRUE,  'color', FALSE, FALSE, FALSE, 40.0,  3, 'perceptual', NULL),
  ('А4 Фото',          'l8050-a4-photo',       'photo',  'photo', 'A4',    'glossy',  'photo',  'fill', TRUE,  'color', FALSE, FALSE, FALSE, 60.0,  4, 'perceptual', NULL),
  ('3x4 Документ',     'l8050-3x4-doc',        'badge',  'photo', '10x15', 'glossy',  'photo',  'actual', FALSE, 'color', FALSE, FALSE, FALSE, 250.0, 5, 'relative_colorimetric',
    '{"enabled": true, "min_faces": 1, "max_faces": 1, "min_face_ratio": 0.6}'::jsonb),
  ('3.5x4.5 Документ', 'l8050-3.5x4.5-doc',   'badge',  'photo', '10x15', 'glossy',  'photo',  'actual', FALSE, 'color', FALSE, FALSE, FALSE, 250.0, 6, 'relative_colorimetric',
    '{"enabled": true, "min_faces": 1, "max_faces": 1, "min_face_ratio": 0.6}'::jsonb),
  ('Сублимация А4',    'l8050-sublimation',    'palette','photo', 'A4',    'sublimation','photo','fill', FALSE, 'color', FALSE, TRUE,  TRUE,  80.0,  7, 'perceptual', NULL)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name, price = EXCLUDED.price, sort_order = EXCLUDED.sort_order;

COMMIT;
