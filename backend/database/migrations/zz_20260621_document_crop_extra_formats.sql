-- backend/database/migrations/zz_20260621_document_crop_extra_formats.sql
-- Геометрические пресеты локального кадрирования под документ. Идемпотентно.
CREATE TABLE IF NOT EXISTS document_crop_presets (
  slug           text PRIMARY KEY,
  label          text NOT NULL,
  photo_w_mm     numeric(6,2) NOT NULL,
  photo_h_mm     numeric(6,2) NOT NULL,
  top_margin_mm  numeric(6,2) NOT NULL,
  head_height_mm numeric(6,2) NOT NULL CHECK (head_height_mm > 0),
  dpi            integer NOT NULL DEFAULT 300 CHECK (dpi > 0),
  jpeg_quality   integer NOT NULL DEFAULT 92 CHECK (jpeg_quality BETWEEN 1 AND 100),
  is_active      boolean NOT NULL DEFAULT true,
  sort_order     integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

INSERT INTO document_crop_presets
  (slug, label, photo_w_mm, photo_h_mm, top_margin_mm, head_height_mm, dpi, jpeg_quality, sort_order)
VALUES
  ('passport_rf', 'Паспорт РФ 35×45', 35, 45, 5, 32, 800, 92, 10),
  ('visa_schengen', 'Виза Шенген 35×45', 35, 45, 3, 32, 800, 92, 20),
  ('photo_3x4', 'Фото 3×4', 30, 40, 3, 26, 800, 92, 30),
  ('photo_9x12', 'Фото 9×12', 90, 120, 10, 65, 800, 92, 40),
  ('photo_4x6', 'Фото 4×6', 40, 60, 5, 34, 800, 92, 50)
ON CONFLICT (slug) DO UPDATE SET
  label = EXCLUDED.label,
  photo_w_mm = EXCLUDED.photo_w_mm,
  photo_h_mm = EXCLUDED.photo_h_mm,
  top_margin_mm = EXCLUDED.top_margin_mm,
  head_height_mm = EXCLUDED.head_height_mm,
  dpi = EXCLUDED.dpi,
  jpeg_quality = EXCLUDED.jpeg_quality,
  is_active = true,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();
