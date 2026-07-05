-- C6 kraft envelopes for document-photo sets on Canon C3226i.
-- Idempotent: appends missing printer capabilities and upserts the print preset.

BEGIN;

WITH canon AS (
  SELECT id, COALESCE(capabilities, '{}'::jsonb) AS capabilities
  FROM printers
  WHERE name ILIKE '%C3226%'
     OR cups_printer_name ILIKE '%C3226%'
     OR cups_printer_name ILIKE '%iR C3226%'
),
paper_updates AS (
  UPDATE printers p
  SET capabilities = jsonb_set(
    c.capabilities,
    '{paper_sizes}',
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(c.capabilities->'paper_sizes') = 'array' THEN c.capabilities->'paper_sizes'
            ELSE '[]'::jsonb
          END
        ) AS elem(value)
        WHERE lower(COALESCE(elem.value->>'id', elem.value#>>'{}')) IN ('c6', 'c6_envelope', 'iso-c6-envelope')
      )
      THEN
        CASE
          WHEN jsonb_typeof(c.capabilities->'paper_sizes') = 'array' THEN c.capabilities->'paper_sizes'
          ELSE '[]'::jsonb
        END
      ELSE
        CASE
          WHEN jsonb_typeof(c.capabilities->'paper_sizes') = 'array' THEN c.capabilities->'paper_sizes'
          ELSE '[]'::jsonb
        END || jsonb_build_array(
          jsonb_build_object('id', 'c6_envelope', 'name', 'C6 конверт', 'width_mm', 114, 'height_mm', 162)
        )
    END,
    true
  )
  FROM canon c
  WHERE p.id = c.id
  RETURNING p.id
),
canon_after_paper AS (
  SELECT p.id, COALESCE(p.capabilities, '{}'::jsonb) AS capabilities
  FROM printers p
  JOIN paper_updates u ON u.id = p.id
)
UPDATE printers p
SET capabilities = jsonb_set(
  c.capabilities,
  '{media_types}',
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(c.capabilities->'media_types') = 'array' THEN c.capabilities->'media_types'
          ELSE '[]'::jsonb
        END
      ) AS elem(value)
      WHERE lower(COALESCE(elem.value->>'id', elem.value#>>'{}')) = 'envelope'
    )
    THEN
      CASE
        WHEN jsonb_typeof(c.capabilities->'media_types') = 'array' THEN c.capabilities->'media_types'
        ELSE '[]'::jsonb
      END
    ELSE
      CASE
        WHEN jsonb_typeof(c.capabilities->'media_types') = 'array' THEN c.capabilities->'media_types'
        ELSE '[]'::jsonb
      END || jsonb_build_array(
        jsonb_build_object('id', 'envelope', 'name', 'Конверт / крафт')
      )
  END,
  true
)
FROM canon_after_paper c
WHERE p.id = c.id;

INSERT INTO print_presets (
  name,
  slug,
  icon,
  printer_type,
  sublimation,
  paper_size,
  media_type,
  quality,
  fit_mode,
  borderless,
  color_mode,
  duplex,
  mirror,
  price,
  sort_order,
  is_active,
  rendering_intent,
  face_requirements
)
VALUES (
  'Конверт C6 крафт «Своё Фото»',
  'envelope-c6-svoefoto-kraft-canon-c3226i',
  'mail',
  'mfp',
  FALSE,
  'c6_envelope',
  'envelope',
  'normal',
  'fit',
  FALSE,
  'color',
  FALSE,
  FALSE,
  10.00,
  22,
  TRUE,
  'relative_colorimetric',
  '{"template":"envelope-c6-svoefoto","material":"kraft","paper_source":"manual","asset_url":"/assets/print-templates/envelope-c6-svoefoto-template.png","html_url":"/assets/print-templates/envelope-c6-svoefoto-template.html"}'::jsonb
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  icon = EXCLUDED.icon,
  printer_type = EXCLUDED.printer_type,
  sublimation = EXCLUDED.sublimation,
  paper_size = EXCLUDED.paper_size,
  media_type = EXCLUDED.media_type,
  quality = EXCLUDED.quality,
  fit_mode = EXCLUDED.fit_mode,
  borderless = EXCLUDED.borderless,
  color_mode = EXCLUDED.color_mode,
  duplex = EXCLUDED.duplex,
  mirror = EXCLUDED.mirror,
  price = EXCLUDED.price,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active,
  rendering_intent = EXCLUDED.rendering_intent,
  face_requirements = EXCLUDED.face_requirements,
  updated_at = NOW();

COMMIT;
