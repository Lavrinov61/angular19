-- Add rendering_intent to print_jobs and print_presets
-- Values: 'perceptual', 'relative_colorimetric', 'saturation', 'absolute_colorimetric'
-- Default 'perceptual' matches current behavior

ALTER TABLE print_jobs
  ADD COLUMN IF NOT EXISTS rendering_intent VARCHAR(30) DEFAULT 'perceptual';

ALTER TABLE print_presets
  ADD COLUMN IF NOT EXISTS rendering_intent VARCHAR(30) DEFAULT 'perceptual';

-- Update document photo presets to use absolute_colorimetric (accurate skin tones)
UPDATE print_presets
  SET rendering_intent = 'absolute_colorimetric'
  WHERE slug IN ('3x4', '35x45', '25x35', 'passport', 'visa')
    AND rendering_intent = 'perceptual';
