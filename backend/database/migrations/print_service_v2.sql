-- Print Service v2.0 — Foundation Migration
-- Idempotent: safe to run multiple times
-- Phase 0 of ФотоПульт v2.0

BEGIN;

-- ═══════════════════════════════════════════════════════════
-- 1. ALTER existing tables
-- ═══════════════════════════════════════════════════════════

-- printers: add CUPS support, make win_printer_name nullable
ALTER TABLE printers ADD COLUMN IF NOT EXISTS cups_printer_name VARCHAR(200);
ALTER TABLE printers ALTER COLUMN win_printer_name DROP NOT NULL;

-- print_jobs: new v2 columns
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS customer_id UUID;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS service_slug VARCHAR(100);
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS document_template_slug VARCHAR(100);
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS original_job_id UUID REFERENCES print_jobs(id) ON DELETE SET NULL;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS cut_marks BOOLEAN DEFAULT FALSE;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS cut_mark_length_mm FLOAT8;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS cut_mark_offset_mm FLOAT8;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS consumable_usage JSONB;

-- print_jobs: extend status CHECK with new states
ALTER TABLE print_jobs DROP CONSTRAINT IF EXISTS print_jobs_status_check;
ALTER TABLE print_jobs ADD CONSTRAINT print_jobs_status_check
  CHECK (status IN ('queued','sending','applying_icc','rendering_layout','printing','completed','failed','cancelled'));

-- bridge_devices: agent type support
ALTER TABLE bridge_devices ADD COLUMN IF NOT EXISTS agent_type VARCHAR(20) DEFAULT 'pos_bridge';
ALTER TABLE bridge_devices ADD COLUMN IF NOT EXISTS cups_version VARCHAR(50);

-- printer_telemetry: consumable tracking
ALTER TABLE printer_telemetry ADD COLUMN IF NOT EXISTS consumable_usage JSONB;

-- ═══════════════════════════════════════════════════════════
-- 2. New tables
-- ═══════════════════════════════════════════════════════════

-- ICC color profiles (per bridge device + media combination)
CREATE TABLE IF NOT EXISTS icc_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES bridge_devices(id) ON DELETE CASCADE,
  media_type VARCHAR(100) NOT NULL,
  profile_name VARCHAR(200) NOT NULL,
  file_key TEXT NOT NULL,
  calibrated_at TIMESTAMPTZ,
  calibrated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  is_default BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- FK: printers → icc_profiles (default ICC profile)
ALTER TABLE printers ADD COLUMN IF NOT EXISTS default_icc_profile_id UUID;
DO $$ BEGIN
  ALTER TABLE printers ADD CONSTRAINT printers_default_icc_profile_id_fkey
    FOREIGN KEY (default_icc_profile_id) REFERENCES icc_profiles(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- FK: print_jobs → icc_profiles
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS icc_profile_id UUID;
DO $$ BEGIN
  ALTER TABLE print_jobs ADD CONSTRAINT print_jobs_icc_profile_id_fkey
    FOREIGN KEY (icc_profile_id) REFERENCES icc_profiles(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Document photo templates (passport, visa, etc.)
CREATE TABLE IF NOT EXISTS document_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(200) NOT NULL,
  category VARCHAR(50) NOT NULL,
  country_code VARCHAR(3) DEFAULT 'RU',
  photo_width_mm FLOAT8 NOT NULL,
  photo_height_mm FLOAT8 NOT NULL,
  head_height_min_mm FLOAT8,
  head_height_max_mm FLOAT8,
  eye_line_from_bottom_mm FLOAT8,
  background_color VARCHAR(7) DEFAULT '#FFFFFF',
  default_media_size VARCHAR(30) DEFAULT '10x15',
  photos_per_sheet INT DEFAULT 1,
  layout_rows INT DEFAULT 1,
  layout_cols INT DEFAULT 1,
  cut_margin_mm FLOAT8 DEFAULT 0,
  validation_rules JSONB DEFAULT '{}',
  overlay_svg TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Service catalog (print, copy, laminate, scan, etc.)
CREATE TABLE IF NOT EXISTS service_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(200) NOT NULL,
  category VARCHAR(50) NOT NULL,
  required_device_type VARCHAR(30),
  requires_template BOOLEAN DEFAULT FALSE,
  requires_design_editor BOOLEAN DEFAULT FALSE,
  base_price FLOAT8 DEFAULT 0,
  price_per_unit FLOAT8 DEFAULT 0,
  price_rules JSONB DEFAULT '{}',
  default_print_profile_id UUID REFERENCES icc_profiles(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Design templates (business cards, flyers — Konva.js canvas)
CREATE TABLE IF NOT EXISTS design_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID REFERENCES service_catalog(id) ON DELETE SET NULL,
  name VARCHAR(200) NOT NULL,
  category VARCHAR(50) NOT NULL,
  width_mm FLOAT8 NOT NULL,
  height_mm FLOAT8 NOT NULL,
  canvas_json TEXT,
  thumbnail_url TEXT,
  editable_fields JSONB DEFAULT '[]',
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Consumable stock levels (ink, paper, toner per station)
CREATE TABLE IF NOT EXISTS consumable_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID NOT NULL REFERENCES bridge_devices(id) ON DELETE CASCADE,
  consumable_type VARCHAR(50) NOT NULL,
  current_amount FLOAT8 NOT NULL DEFAULT 0,
  max_capacity FLOAT8,
  unit VARCHAR(20) NOT NULL DEFAULT 'ml',
  low_threshold FLOAT8,
  cost_per_unit FLOAT8,
  last_refilled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (station_id, consumable_type)
);

-- Consumable transaction log
CREATE TABLE IF NOT EXISTS consumable_transactions (
  id BIGSERIAL PRIMARY KEY,
  stock_id UUID NOT NULL REFERENCES consumable_stock(id) ON DELETE CASCADE,
  job_id UUID REFERENCES print_jobs(id) ON DELETE SET NULL,
  transaction_type VARCHAR(20) NOT NULL CHECK (transaction_type IN ('usage','refill','adjustment','waste')),
  amount FLOAT8 NOT NULL,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════
-- 3. Indexes
-- ═══════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_icc_profiles_device ON icc_profiles(device_id);
CREATE INDEX IF NOT EXISTS idx_icc_profiles_active ON icc_profiles(is_active) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_document_templates_active ON document_templates(is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_service_catalog_active ON service_catalog(is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_design_templates_service ON design_templates(service_id);
CREATE INDEX IF NOT EXISTS idx_design_templates_active ON design_templates(is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_consumable_stock_station ON consumable_stock(station_id);
CREATE INDEX IF NOT EXISTS idx_consumable_stock_low ON consumable_stock(station_id)
  WHERE current_amount <= low_threshold;
CREATE INDEX IF NOT EXISTS idx_consumable_transactions_stock ON consumable_transactions(stock_id);
CREATE INDEX IF NOT EXISTS idx_consumable_transactions_job ON consumable_transactions(job_id)
  WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_print_jobs_customer ON print_jobs(customer_id)
  WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_print_jobs_service_slug ON print_jobs(service_slug)
  WHERE service_slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_print_jobs_original_job ON print_jobs(original_job_id)
  WHERE original_job_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════
-- 4. Recreate printer_current_status VIEW with new fields
-- ═══════════════════════════════════════════════════════════

DROP VIEW IF EXISTS printer_current_status;
CREATE VIEW printer_current_status AS
SELECT DISTINCT ON (pt.printer_id)
  pt.*,
  p.name AS printer_name,
  p.printer_type,
  p.win_printer_name,
  p.cups_printer_name,
  bd.name AS bridge_name,
  bd.is_online AS bridge_online,
  bd.agent_type
FROM printer_telemetry pt
JOIN printers p ON p.id = pt.printer_id
LEFT JOIN bridge_devices bd ON bd.id = pt.bridge_device_id
ORDER BY pt.printer_id, pt.collected_at DESC;

-- ═══════════════════════════════════════════════════════════
-- 5. Seed data: document templates
-- ═══════════════════════════════════════════════════════════

INSERT INTO document_templates (slug, name, category, country_code, photo_width_mm, photo_height_mm, head_height_min_mm, head_height_max_mm, eye_line_from_bottom_mm, background_color, default_media_size, photos_per_sheet, layout_rows, layout_cols, cut_margin_mm, sort_order)
VALUES
  ('passport-rf',     'Паспорт РФ',                'identity', 'RU', 35, 45, 32, 36, 27, '#FFFFFF', '10x15', 6, 3, 2, 2, 1),
  ('zagranpassport',  'Загранпаспорт',              'identity', 'RU', 35, 45, 32, 36, 27, '#FFFFFF', '10x15', 6, 3, 2, 2, 2),
  ('visa-schengen',   'Виза Шенген',                'visa',     'EU', 35, 45, 32, 36, 27, '#FFFFFF', '10x15', 6, 3, 2, 2, 3),
  ('visa-usa',        'Виза США',                   'visa',     'US', 51, 51, 25, 35, 29, '#FFFFFF', '10x15', 4, 2, 2, 2, 4),
  ('visa-china',      'Виза Китай',                 'visa',     'CN', 33, 48, 28, 33, 26, '#FFFFFF', '10x15', 6, 3, 2, 2, 5),
  ('driver-license',  'Водительское удостоверение',  'identity', 'RU', 30, 40, 20, 25, 22, '#FFFFFF', '10x15', 6, 3, 2, 2, 6),
  ('medical-book',    'Медицинская книжка',          'medical',  'RU', 30, 40, 20, 25, 22, '#FFFFFF', '10x15', 6, 3, 2, 2, 7),
  ('military-id',     'Военный билет',               'identity', 'RU', 30, 40, 18, 25, 22, '#FFFFFF', '10x15', 6, 3, 2, 2, 8)
ON CONFLICT (slug) DO NOTHING;

-- ═══════════════════════════════════════════════════════════
-- 6. Seed data: service catalog
-- ═══════════════════════════════════════════════════════════

INSERT INTO service_catalog (slug, name, category, required_device_type, requires_template, requires_design_editor, base_price, price_per_unit, sort_order)
VALUES
  ('photo-10x15',    'Фотопечать 10×15',       'photo_print',    'photo',    false, false, 0,    15,   1),
  ('photo-15x20',    'Фотопечать 15×20',       'photo_print',    'photo',    false, false, 0,    40,   2),
  ('photo-20x30',    'Фотопечать 20×30',       'photo_print',    'photo',    false, false, 0,    80,   3),
  ('photo-a4',       'Фотопечать A4',          'photo_print',    'photo',    false, false, 0,    120,  4),
  ('copy-bw-a4',     'Ксерокопия ч/б A4',      'copy',           'document', false, false, 0,    10,   10),
  ('copy-color-a4',  'Ксерокопия цвет A4',     'copy',           'document', false, false, 0,    30,   11),
  ('laminate-a4',    'Ламинирование A4',        'lamination',     NULL,       false, false, 0,    100,  20),
  ('laminate-a5',    'Ламинирование A5',        'lamination',     NULL,       false, false, 0,    70,   21),
  ('scan-a4',        'Сканирование A4',         'scan',           'mfp',      false, false, 0,    30,   30),
  ('doc-photo',      'Фото на документы',       'document_photo', 'photo',    true,  false, 350,  0,    40),
  ('business-cards', 'Визитки (100 шт)',        'polygraphy',     NULL,       false, true,  1500, 0,    50),
  ('flyer-a5',       'Флаеры A5 (100 шт)',     'polygraphy',     NULL,       false, true,  2500, 0,    51)
ON CONFLICT (slug) DO NOTHING;

COMMIT;
