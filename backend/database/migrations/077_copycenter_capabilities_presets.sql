-- Migration 077: Copycenter capabilities, presets & ICC profiles
-- Idempotent: safe to re-run

BEGIN;

-- ============================================================
-- 1. SC-F100 capabilities: sublimation-specific fields
-- ============================================================
UPDATE printers
SET capabilities = capabilities || jsonb_build_object(
    'temperature_range', jsonb_build_object('min_celsius', 180, 'max_celsius', 210, 'default_celsius', 200),
    'heat_press_required', true,
    'press_time_seconds', jsonb_build_object('min', 30, 'max', 90, 'default', 60),
    'transfer_paper_types', jsonb_build_array(
      jsonb_build_object('id', 'epson_ds_general', 'name', 'Epson DS Transfer General', 'for', 'cotton_poly'),
      jsonb_build_object('id', 'epson_ds_rigid', 'name', 'Epson DS Transfer Rigid', 'for', 'ceramics_metal'),
      jsonb_build_object('id', 'generic_sublimation', 'name', 'Универсальная сублимационная', 'for', 'polyester')
    ),
    'substrate_types', jsonb_build_array('polyester', 'poly_coated_ceramics', 'poly_coated_metal', 'poly_coated_wood', 'polymer_fabric'),
    'ink_system', 'refillable',
    'max_gsm', 300
  )
WHERE name = 'Epson SC-F100' AND is_active = true;

-- ============================================================
-- 2. New presets: SC-F100 sublimation products
-- ============================================================
INSERT INTO print_presets (name, slug, icon, printer_type, sublimation, paper_size, media_type, quality, color_mode, mirror, duplex, borderless, fit_mode, price, sort_order, rendering_intent, is_active)
VALUES
  ('Кружка 330 мл', 'scf100-mug-330ml', 'coffee', 'photo', TRUE, 'A4', 'sublimation', 'high', 'color', TRUE, FALSE, FALSE, 'fill', 200, 62, 'perceptual', TRUE),
  ('Футболка А4', 'scf100-tshirt', 'checkroom', 'photo', TRUE, 'A4', 'sublimation', 'high', 'color', TRUE, FALSE, FALSE, 'fill', 500, 63, 'perceptual', TRUE),
  ('Подушка 40×40', 'scf100-pillow', 'king_bed', 'photo', TRUE, 'A4', 'sublimation', 'high', 'color', TRUE, FALSE, FALSE, 'fill', 800, 64, 'perceptual', TRUE),
  ('Пазл А4', 'scf100-puzzle', 'extension', 'photo', TRUE, 'A4', 'sublimation', 'high', 'color', TRUE, FALSE, FALSE, 'fill', 400, 65, 'perceptual', TRUE),
  ('Коврик для мыши', 'scf100-mousepad', 'mouse', 'photo', TRUE, 'A4', 'sublimation', 'high', 'color', TRUE, FALSE, FALSE, 'fill', 300, 66, 'perceptual', TRUE),
  ('Магнит А5', 'scf100-magnet', 'push_pin', 'photo', TRUE, 'A5', 'sublimation', 'high', 'color', TRUE, FALSE, FALSE, 'fill', 150, 67, 'perceptual', TRUE)
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, price = EXCLUDED.price, is_active = TRUE;

-- ============================================================
-- 3. New presets: L8050 semi-glossy & luster
-- ============================================================
INSERT INTO print_presets (name, slug, icon, printer_type, paper_size, media_type, quality, color_mode, duplex, borderless, sublimation, mirror, fit_mode, price, sort_order, rendering_intent, is_active)
VALUES
  ('10×15 Полуглянцевая', 'l8050-10x15-semi', 'photo', 'photo', '10x15', 'semi_glossy', 'photo', 'color', FALSE, TRUE, FALSE, FALSE, 'fill', 15, 23, 'perceptual', TRUE),
  ('13×18 Полуглянцевая', 'l8050-13x18-semi', 'photo', 'photo', '13x18', 'semi_glossy', 'photo', 'color', FALSE, TRUE, FALSE, FALSE, 'fill', 30, 24, 'perceptual', TRUE),
  ('A4 Полуглянцевая', 'l8050-a4-semi', 'photo', 'photo', 'A4', 'semi_glossy', 'photo', 'color', FALSE, TRUE, FALSE, FALSE, 'fill', 65, 25, 'perceptual', TRUE),
  ('10×15 Люстр', 'l8050-10x15-luster', 'photo', 'photo', '10x15', 'luster', 'photo', 'color', FALSE, TRUE, FALSE, FALSE, 'fill', 20, 26, 'perceptual', TRUE),
  ('A4 Люстр', 'l8050-a4-luster', 'photo', 'photo', 'A4', 'luster', 'photo', 'color', FALSE, TRUE, FALSE, FALSE, 'fill', 70, 27, 'perceptual', TRUE)
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, price = EXCLUDED.price, is_active = TRUE;

-- ============================================================
-- 4. Fix zero-price presets
-- ============================================================
UPDATE print_presets SET price = 80 WHERE slug = 'scf100-a4-sub' AND price = 0;
UPDATE print_presets SET price = 50 WHERE slug = 'scf100-a5-sub' AND price = 0;
UPDATE print_presets SET price = 100 WHERE slug = 'l8050-20x30' AND price = 0;
UPDATE print_presets SET price = 15 WHERE slug = 'l8050-10x15-matte' AND price = 0;
UPDATE print_presets SET price = 65 WHERE slug = 'l8050-a4-matte' AND price = 0;

-- ============================================================
-- 5. ICC profiles (device_id -> bridge_devices)
--    b0000001 = Соборный Print Agent (L8050 левый/правый + SC-F100)
--    Existing matte profile (776c9098) on b0000002 stays as-is
-- ============================================================

-- L8050 Premium Glossy (is_default for glossy)
INSERT INTO icc_profiles (id, device_id, media_type, profile_name, file_key, calibrated_at, is_default, is_active)
VALUES (gen_random_uuid(), 'b0000001-0000-0000-0000-000000000001', 'glossy', 'EPSON L8050 Series Premium Glossy', 'icc/EPSON L8050 Series Premium Glossy.icc', NOW(), true, true)
ON CONFLICT DO NOTHING;

-- L8050 Matte (on device b0000001, existing one on b0000002 stays)
INSERT INTO icc_profiles (id, device_id, media_type, profile_name, file_key, calibrated_at, is_default, is_active)
VALUES (gen_random_uuid(), 'b0000001-0000-0000-0000-000000000001', 'matte', 'EPSON L8050 Series Matte', 'icc/EPSON L8050 Series Matte.icc', NOW(), false, true)
ON CONFLICT DO NOTHING;

-- L8050 Premium Semigloss
INSERT INTO icc_profiles (id, device_id, media_type, profile_name, file_key, calibrated_at, is_default, is_active)
VALUES (gen_random_uuid(), 'b0000001-0000-0000-0000-000000000001', 'semi_glossy', 'EPSON L8050 Series Premium Semigloss', 'icc/EPSON L8050 Series Premium Semigloss.icc', NOW(), true, true)
ON CONFLICT DO NOTHING;

-- L8050 Premium Luster
INSERT INTO icc_profiles (id, device_id, media_type, profile_name, file_key, calibrated_at, is_default, is_active)
VALUES (gen_random_uuid(), 'b0000001-0000-0000-0000-000000000001', 'luster', 'EPSON L8050 Series Premium Luster', 'icc/EPSON L8050 Series Premium Luster.icc', NOW(), true, true)
ON CONFLICT DO NOTHING;

-- SC-F100 GeneralPurpose Textile (default for sublimation)
INSERT INTO icc_profiles (id, device_id, media_type, profile_name, file_key, calibrated_at, is_default, is_active)
VALUES (gen_random_uuid(), 'b0000001-0000-0000-0000-000000000001', 'sublimation_textile', 'Epson SC-F100 GeneralPurpose (Textile)', 'icc/Epson SC-F100 Series GeneralPurpose(Textile).icc', NOW(), true, true)
ON CONFLICT DO NOTHING;

-- SC-F100 GeneralPurpose Rigid
INSERT INTO icc_profiles (id, device_id, media_type, profile_name, file_key, calibrated_at, is_default, is_active)
VALUES (gen_random_uuid(), 'b0000001-0000-0000-0000-000000000001', 'sublimation_rigid', 'Epson SC-F100 GeneralPurpose (Rigid)', 'icc/Epson SC-F100 Series GeneralPurpose(Rigid).icc', NOW(), false, true)
ON CONFLICT DO NOTHING;

COMMIT;
