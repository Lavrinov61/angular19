-- Canon C3226i business-card print presets.
-- Price is derived from the active catalog service "business-cards":
-- 100 cards / 10 cards per A4 sheet = 10 sheets, so sheet price = base_price / 10.

BEGIN;

UPDATE print_presets
SET is_active = FALSE,
    updated_at = NOW()
WHERE slug IN ('business_card_90x50', 'business_card_85x55');

WITH catalog_price AS (
  SELECT (base_price::numeric / 10)::numeric(10,2) AS sheet_price
  FROM service_catalog
  WHERE slug = 'business-cards'
    AND is_active = TRUE
    AND base_price > 0
  LIMIT 1
)
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
SELECT
  v.name,
  v.slug,
  'contact_page',
  'mfp',
  FALSE,
  'A4',
  'heavy6',
  'normal',
  'fit',
  FALSE,
  'color',
  FALSE,
  FALSE,
  cp.sheet_price,
  v.sort_order,
  TRUE,
  'relative_colorimetric',
  v.face_requirements
FROM catalog_price cp
CROSS JOIN (
  VALUES
    (
      'Визитка 90x50 A4 Canon C3226i',
      'business-card-90x50-a4-canon-c3226i',
      14,
      '{"template":"business-card-a4","photo_preset_id":"business-card","cols":2,"rows":5,"paper_source":"manual","media_type":"heavy6","cards_per_sheet":10}'::jsonb
    ),
    (
      'Визитка 85x55 A4 Canon C3226i',
      'business-card-85x55-a4-canon-c3226i',
      15,
      '{"template":"business-card-a4","photo_preset_id":"business-card-eu","cols":2,"rows":5,"paper_source":"manual","media_type":"heavy6","cards_per_sheet":10}'::jsonb
    )
) AS v(name, slug, sort_order, face_requirements)
WHERE cp.sheet_price > 0
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
