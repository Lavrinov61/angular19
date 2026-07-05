UPDATE document_crop_presets
SET dpi = 800,
    updated_at = now()
WHERE slug = 'passport_rf';
