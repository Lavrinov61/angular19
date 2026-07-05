-- Migration 050: Add Polaroid 10×15 print preset
-- Polaroid 600 template: 88×107mm card, 79×79mm square photo on 10×15 sheet

INSERT INTO print_presets (
  name, slug, icon, printer_type, sublimation,
  paper_size, media_type, quality, fit_mode, borderless,
  color_mode, duplex, mirror, rendering_intent,
  price, sort_order, is_active,
  face_requirements
) VALUES (
  'Polaroid 10×15', 'polaroid_10x15', 'photo_camera', 'photo', false,
  '10x15', 'glossy', 'photo', 'fill', true,
  'color', false, false, 'perceptual',
  25.00, 50, true,
  '{"smart_crop": true, "template": "polaroid_600", "card_width_mm": 88, "card_height_mm": 107, "photo_size_mm": 79, "border_top_mm": 5, "border_side_mm": 4.5, "border_bottom_mm": 23}'::jsonb
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  face_requirements = EXCLUDED.face_requirements,
  updated_at = NOW();
