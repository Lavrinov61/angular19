-- Register the business-card A4 sheet layout used by employee print jobs.
-- Print jobs store document_template_slug and the FK requires a matching row.

BEGIN;

INSERT INTO document_templates (
  slug,
  name,
  category,
  country_code,
  photo_width_mm,
  photo_height_mm,
  background_color,
  default_media_size,
  photos_per_sheet,
  layout_rows,
  layout_cols,
  cut_margin_mm,
  validation_rules,
  is_active,
  sort_order
)
VALUES (
  'business-card-a4',
  'Визитки на A4',
  'business_card',
  'RU',
  90,
  50,
  '#FFFFFF',
  'A4',
  10,
  5,
  2,
  4,
  '{"kind":"print_layout","supported_presets":["business-card","business-card-eu"],"supported_sizes":["90x50","85x55"]}'::jsonb,
  TRUE,
  900
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  country_code = EXCLUDED.country_code,
  photo_width_mm = EXCLUDED.photo_width_mm,
  photo_height_mm = EXCLUDED.photo_height_mm,
  background_color = EXCLUDED.background_color,
  default_media_size = EXCLUDED.default_media_size,
  photos_per_sheet = EXCLUDED.photos_per_sheet,
  layout_rows = EXCLUDED.layout_rows,
  layout_cols = EXCLUDED.layout_cols,
  cut_margin_mm = EXCLUDED.cut_margin_mm,
  validation_rules = EXCLUDED.validation_rules,
  is_active = TRUE,
  sort_order = EXCLUDED.sort_order,
  updated_at = NOW();

COMMIT;
