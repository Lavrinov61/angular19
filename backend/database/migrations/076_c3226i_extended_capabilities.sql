-- Migration 076: Extended Canon C3226i capabilities + additional presets
-- Date: 2026-04-05
-- Idempotent: uses ON CONFLICT, jsonb update preserves existing keys

-- 1. Update finishing from string array to structured objects with icons, add coated media type
UPDATE printers SET capabilities = capabilities
  || jsonb_build_object(
    'finishing', jsonb_build_array(
      jsonb_build_object('id', 'staple', 'name', 'Сшивка', 'icon', 'push_pin'),
      jsonb_build_object('id', 'punch', 'name', 'Перфорация', 'icon', 'radio_button_unchecked'),
      jsonb_build_object('id', 'fold', 'name', 'Фальцовка', 'icon', 'file_copy'),
      jsonb_build_object('id', 'booklet', 'name', 'Брошюра', 'icon', 'menu_book')
    ),
    'media_types', jsonb_build_array(
      jsonb_build_object('id', 'plain', 'name', 'Обычная'),
      jsonb_build_object('id', 'thick', 'name', 'Плотная'),
      jsonb_build_object('id', 'heavy', 'name', 'Тяжёлая'),
      jsonb_build_object('id', 'labels', 'name', 'Этикетки'),
      jsonb_build_object('id', 'envelope', 'name', 'Конверт'),
      jsonb_build_object('id', 'transparency', 'name', 'Плёнка'),
      jsonb_build_object('id', 'recycled', 'name', 'Переработанная'),
      jsonb_build_object('id', 'coated', 'name', 'Мелованная')
    )
  )
WHERE name = 'Canon C3226i';

-- 2. Additional presets for C3226i
INSERT INTO print_presets (name, slug, icon, printer_type, paper_size, media_type, quality, fit_mode, borderless, color_mode, duplex, mirror, sublimation, price, sort_order, rendering_intent, is_active)
VALUES
  ('А5 Цветная',   'c3226i-a5-color',  'print', 'mfp', 'A5', 'plain',  'normal', 'fit', FALSE, 'color', FALSE, FALSE, FALSE, 10.00, 16, 'relative_colorimetric', TRUE),
  ('А5 ч/б',       'c3226i-a5-bw',     'print', 'mfp', 'A5', 'plain',  'normal', 'fit', FALSE, 'bw',    FALSE, FALSE, FALSE,  4.00, 17, 'relative_colorimetric', TRUE),
  ('B4 Цветная',   'c3226i-b4-color',  'print', 'mfp', 'B4', 'plain',  'normal', 'fit', FALSE, 'color', FALSE, FALSE, FALSE, 25.00, 18, 'relative_colorimetric', TRUE),
  ('B5 Цветная',   'c3226i-b5-color',  'print', 'mfp', 'B5', 'plain',  'normal', 'fit', FALSE, 'color', FALSE, FALSE, FALSE, 12.00, 19, 'relative_colorimetric', TRUE),
  ('Этикетки A4',  'c3226i-a4-labels', 'print', 'mfp', 'A4', 'labels', 'normal', 'fit', FALSE, 'color', FALSE, FALSE, FALSE, 20.00, 20, 'relative_colorimetric', TRUE),
  ('Мелованная A4','c3226i-a4-coated', 'print', 'mfp', 'A4', 'coated', 'high',   'fit', FALSE, 'color', FALSE, FALSE, FALSE, 20.00, 21, 'relative_colorimetric', TRUE)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  price = EXCLUDED.price,
  sort_order = EXCLUDED.sort_order,
  is_active = TRUE;
