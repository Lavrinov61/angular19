-- 078_retouch_presets.sql — Preset templates for retouch tasks

CREATE TABLE IF NOT EXISTS retouch_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  retouch_level VARCHAR(20) NOT NULL CHECK (retouch_level IN ('basic', 'extended', 'maximum')),
  retouch_options JSONB NOT NULL DEFAULT '[]'::jsonb,
  document_type VARCHAR(50),
  price NUMERIC(10,2),
  sort_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed data
INSERT INTO retouch_presets (name, description, retouch_level, retouch_options, document_type, price, sort_order)
VALUES
  ('Паспорт РФ — базовая', 'Базовая обработка для паспорта РФ', 'basic', '["face_cleanup"]'::jsonb, 'passport_rf', 700, 1),
  ('Паспорт РФ — расширенная', 'Чистка лица, фона, выравнивание плеч', 'extended', '["face_cleanup","background_cleanup","shoulder_align","hair_fix"]'::jsonb, 'passport_rf', 950, 2),
  ('Паспорт РФ — максимальная', 'Полная обработка', 'maximum', '["face_cleanup","skin_smoothing","background_cleanup","shoulder_align","hair_fix","color_correction","glare_removal"]'::jsonb, 'passport_rf', 1400, 3),
  ('Загранпаспорт — базовая', 'Базовая для загранпаспорта', 'basic', '["face_cleanup"]'::jsonb, 'passport_intl', 700, 4),
  ('Загранпаспорт — расширенная', 'Расширенная для загранпаспорта', 'extended', '["face_cleanup","background_cleanup","shoulder_align","hair_fix"]'::jsonb, 'passport_intl', 950, 5),
  ('Виза — расширенная', 'Расширенная для визы', 'extended', '["face_cleanup","background_cleanup","shoulder_align"]'::jsonb, 'visa', 950, 6),
  ('Портрет — базовая', 'Базовая ретушь портрета', 'basic', '["face_cleanup","skin_smoothing"]'::jsonb, 'portrait', 500, 7),
  ('Портрет — максимальная', 'Полная ретушь портрета', 'maximum', '["face_cleanup","skin_smoothing","background_change","color_correction","eye_enhancement","hair_fix"]'::jsonb, 'portrait', 1500, 8)
ON CONFLICT DO NOTHING;
