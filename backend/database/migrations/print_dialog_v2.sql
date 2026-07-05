-- Print Dialog V2: add Epson SC-F100, fix paper_sizes, add paper_sources & quality_modes
-- Idempotent: uses WHERE NOT EXISTS / conflict-safe updates

BEGIN;

-- 1. Add Epson SC-F100 (sublimation) to Soborny studio
INSERT INTO printers (id, name, printer_type, studio_id, capabilities, is_active)
SELECT
  gen_random_uuid(),
  'Epson SC-F100',
  'photo',
  s.id,
  '{
    "color": true,
    "duplex": false,
    "max_dpi": 5760,
    "borderless": false,
    "sublimation": true,
    "mirror_default": true,
    "media_types": [
      {"id": "ds_transfer", "name": "DS Transfer General Purpose"},
      {"id": "ds_transfer_rigid", "name": "DS Transfer rigid material"}
    ],
    "paper_sizes": [
      {"id": "A4", "name": "A4", "width_mm": 210, "height_mm": 297}
    ],
    "quality_modes": [
      {"id": "standard", "name": "Standard"},
      {"id": "high", "name": "High"}
    ]
  }'::jsonb,
  true
FROM studios s
WHERE s.name ILIKE '%Соборный%'
  AND NOT EXISTS (
    SELECT 1 FROM printers p WHERE p.name = 'Epson SC-F100' AND p.studio_id = s.id
  );

-- 2. Fix Canon MF655CDw paper_sizes: lowercase a4/a5 -> uppercase A4/A5
UPDATE printers SET capabilities = jsonb_set(
  capabilities,
  '{paper_sizes}',
  '[{"id":"A4","name":"A4","width_mm":210,"height_mm":297},{"id":"A5","name":"A5","width_mm":148,"height_mm":210}]'::jsonb
) WHERE name = 'Canon MF655CDw';

-- 3. Add paper_sources to Canon C3226i
UPDATE printers SET capabilities = capabilities || '{"paper_sources":[{"id":"auto","name":"Auto"},{"id":"tray1","name":"Tray 1"},{"id":"tray2","name":"Tray 2"},{"id":"universal","name":"Universal tray"}]}'::jsonb
WHERE name = 'Canon C3226i';

-- 4. Add paper_sources to Canon MF655CDw
UPDATE printers SET capabilities = capabilities || '{"paper_sources":[{"id":"auto","name":"Auto"},{"id":"tray1","name":"Tray 1"},{"id":"universal","name":"Universal tray"}]}'::jsonb
WHERE name = 'Canon MF655CDw';

-- 5. Add extended quality_modes to Canon C3226i
UPDATE printers SET capabilities = jsonb_set(
  capabilities,
  '{quality_modes}',
  '[{"id":"draft","name":"Draft"},{"id":"normal","name":"Standard"},{"id":"high","name":"High quality"},{"id":"photo","name":"Photo sharp"},{"id":"cad","name":"CAD drawings"},{"id":"text_precision","name":"High precision text"}]'::jsonb
) WHERE name = 'Canon C3226i';

COMMIT;
