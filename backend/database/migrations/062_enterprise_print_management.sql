-- 062_enterprise_print_management.sql
-- Enterprise print management: state transitions audit, job templates, constraints, triggers, capabilities, presets

BEGIN;

-- ============================================================
-- 1. job_state_transitions — audit trail for status changes
-- ============================================================
CREATE TABLE IF NOT EXISTS job_state_transitions (
  id             BIGSERIAL PRIMARY KEY,
  job_id         UUID NOT NULL REFERENCES print_jobs(id) ON DELETE CASCADE,
  from_status    VARCHAR(20) NOT NULL,
  to_status      VARCHAR(20) NOT NULL,
  actor_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_type     VARCHAR(20) NOT NULL DEFAULT 'user'
                   CHECK (actor_type IN ('user','system','agent','scheduler')),
  reason         TEXT,
  metadata       JSONB DEFAULT '{}',
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_state_transitions_job
  ON job_state_transitions (job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_job_state_transitions_actor
  ON job_state_transitions (actor_id, created_at DESC)
  WHERE actor_id IS NOT NULL;


-- ============================================================
-- 2. job_templates — saved job templates
-- ============================================================
CREATE TABLE IF NOT EXISTS job_templates (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name           VARCHAR(200) NOT NULL,
  description    TEXT,
  settings       JSONB NOT NULL DEFAULT '{}',
  printer_type   VARCHAR(20) NOT NULL CHECK (printer_type IN ('photo','mfp','document','sublimation')),
  printer_id     UUID REFERENCES printers(id) ON DELETE SET NULL,
  studio_id      UUID REFERENCES studios(id) ON DELETE SET NULL,
  is_global      BOOLEAN DEFAULT FALSE,
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  usage_count    INTEGER DEFAULT 0,
  last_used_at   TIMESTAMPTZ,
  sort_order     INTEGER DEFAULT 0,
  is_active      BOOLEAN DEFAULT TRUE,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_templates_type
  ON job_templates (printer_type, is_active, sort_order);

CREATE INDEX IF NOT EXISTS idx_job_templates_studio
  ON job_templates (studio_id, is_active)
  WHERE studio_id IS NOT NULL;


-- ============================================================
-- 3. CHECK constraint on split_strategy
-- ============================================================
DO $$ BEGIN
  ALTER TABLE print_jobs DROP CONSTRAINT IF EXISTS print_jobs_split_strategy_check;
  ALTER TABLE print_jobs ADD CONSTRAINT print_jobs_split_strategy_check
    CHECK (split_strategy IS NULL OR split_strategy IN ('even','round_robin','by_capability','manual'));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'split_strategy CHECK: %', SQLERRM;
END $$;


-- ============================================================
-- 4. UNIQUE index on tracking_code (replace non-unique)
-- ============================================================
DROP INDEX IF EXISTS idx_print_jobs_tracking;
CREATE UNIQUE INDEX IF NOT EXISTS idx_print_jobs_tracking_unique
  ON print_jobs (tracking_code) WHERE tracking_code IS NOT NULL;


-- ============================================================
-- 5. Trigger — auto-log state transitions on status change
-- ============================================================
CREATE OR REPLACE FUNCTION log_job_state_transition()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO job_state_transitions (job_id, from_status, to_status, actor_id, actor_type, reason)
    VALUES (
      NEW.id, OLD.status, NEW.status,
      COALESCE(NEW.held_by, NEW.released_by, NEW.reassigned_by, NEW.created_by),
      CASE
        WHEN NEW.status IN ('splitting','applying_icc','rendering_layout','converting') THEN 'agent'
        WHEN NEW.status = 'scheduled' AND NEW.scheduled_at IS NOT NULL THEN 'scheduler'
        ELSE 'user'
      END,
      CASE
        WHEN NEW.error_message IS NOT NULL AND OLD.error_message IS DISTINCT FROM NEW.error_message THEN NEW.error_message
        WHEN NEW.reassign_reason IS NOT NULL AND OLD.reassign_reason IS DISTINCT FROM NEW.reassign_reason THEN NEW.reassign_reason
        ELSE NULL
      END
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_job_state_transition_log ON print_jobs;
CREATE TRIGGER trg_job_state_transition_log
  AFTER UPDATE OF status ON print_jobs
  FOR EACH ROW EXECUTE FUNCTION log_job_state_transition();


-- ============================================================
-- 6. Trigger — validate finishing_ops array values
-- ============================================================
CREATE OR REPLACE FUNCTION validate_finishing_ops()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE op TEXT;
  allowed TEXT[] := ARRAY['staple','punch','fold','booklet','laminate','trim','round_corners','bind_spiral','bind_thermal'];
BEGIN
  IF NEW.finishing_ops IS NOT NULL THEN
    FOREACH op IN ARRAY NEW.finishing_ops LOOP
      IF op != ALL(allowed) THEN
        RAISE EXCEPTION 'Invalid finishing operation: %. Allowed: %', op, array_to_string(allowed, ', ');
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_finishing_ops ON print_jobs;
CREATE TRIGGER trg_validate_finishing_ops
  BEFORE INSERT OR UPDATE OF finishing_ops ON print_jobs
  FOR EACH ROW EXECUTE FUNCTION validate_finishing_ops();


-- ============================================================
-- 7. UPDATE printer capabilities with real specifications
-- ============================================================

-- Canon imageRUNNER C3226i (id: 49a1bd1a-c34d-49e9-9eaa-82e79357a177)
UPDATE printers SET capabilities = '{
  "color": true,
  "duplex": true,
  "max_dpi": 1200,
  "borderless": false,
  "ppm": 26,
  "max_gsm": 220,
  "ink_count": 4,
  "ink_type": "toner",
  "finishing": ["staple","punch","fold","booklet"],
  "media_types": [
    {"id": "plain", "name": "Обычная"},
    {"id": "thick", "name": "Плотная"},
    {"id": "heavy", "name": "Тяжёлая"},
    {"id": "labels", "name": "Этикетки"},
    {"id": "envelope", "name": "Конверт"},
    {"id": "transparency", "name": "Плёнка"},
    {"id": "recycled", "name": "Переработанная"}
  ],
  "paper_sizes": [
    {"id": "A3", "name": "A3", "width_mm": 297, "height_mm": 420},
    {"id": "A4", "name": "A4", "width_mm": 210, "height_mm": 297},
    {"id": "A5", "name": "A5", "width_mm": 148, "height_mm": 210},
    {"id": "B4", "name": "B4", "width_mm": 250, "height_mm": 353},
    {"id": "B5", "name": "B5", "width_mm": 176, "height_mm": 250},
    {"id": "SRA3", "name": "SRA3", "width_mm": 320, "height_mm": 450}
  ],
  "paper_sources": [
    {"id": "auto", "name": "Авто"},
    {"id": "tray1", "name": "Лоток 1"},
    {"id": "tray2", "name": "Лоток 2"},
    {"id": "universal", "name": "Универсальный лоток"}
  ],
  "quality_modes": [
    {"id": "draft", "name": "Черновик"},
    {"id": "normal", "name": "Стандарт"},
    {"id": "high", "name": "Высокое качество"},
    {"id": "photo", "name": "Фото"},
    {"id": "cad", "name": "Чертежи CAD"},
    {"id": "text_precision", "name": "Точный текст"}
  ]
}'::jsonb
WHERE id = '49a1bd1a-c34d-49e9-9eaa-82e79357a177';

-- Canon MF655CDw (id: 877f10f9-b865-49cb-82b5-d0dd227e84d2)
UPDATE printers SET capabilities = '{
  "color": true,
  "duplex": true,
  "max_dpi": 1200,
  "borderless": false,
  "ppm": 21,
  "max_gsm": 163,
  "ink_count": 4,
  "ink_type": "toner",
  "finishing": [],
  "media_types": [
    {"id": "plain", "name": "Обычная"},
    {"id": "thick", "name": "Плотная"},
    {"id": "labels", "name": "Этикетки"},
    {"id": "envelope", "name": "Конверт"}
  ],
  "paper_sizes": [
    {"id": "A4", "name": "A4", "width_mm": 210, "height_mm": 297},
    {"id": "A5", "name": "A5", "width_mm": 148, "height_mm": 210},
    {"id": "B5", "name": "B5", "width_mm": 176, "height_mm": 250},
    {"id": "Legal", "name": "Legal", "width_mm": 216, "height_mm": 356},
    {"id": "Letter", "name": "Letter", "width_mm": 216, "height_mm": 279}
  ],
  "paper_sources": [
    {"id": "auto", "name": "Авто"},
    {"id": "tray1", "name": "Лоток 1"},
    {"id": "universal", "name": "Универсальный лоток"}
  ],
  "quality_modes": [
    {"id": "draft", "name": "Черновик"},
    {"id": "normal", "name": "Стандарт"},
    {"id": "high", "name": "Высокое"}
  ]
}'::jsonb
WHERE id = '877f10f9-b865-49cb-82b5-d0dd227e84d2';

-- Epson L8050 (id: d6d0ecdb-30e5-4155-aebe-b83af65fd1d6)
UPDATE printers SET capabilities = '{
  "color": true,
  "duplex": false,
  "max_dpi": 5760,
  "borderless": true,
  "ppm": 8,
  "max_gsm": 300,
  "ink_count": 6,
  "ink_type": "dye",
  "ink_system": "CISS",
  "finishing": [],
  "media_types": [
    {"id": "glossy", "name": "Глянцевая"},
    {"id": "semi_glossy", "name": "Полуглянцевая"},
    {"id": "matte", "name": "Матовая"},
    {"id": "luster", "name": "Люстр"},
    {"id": "plain", "name": "Обычная"}
  ],
  "paper_sizes": [
    {"id": "10x15", "name": "10x15 см", "width_mm": 100, "height_mm": 150},
    {"id": "13x18", "name": "13x18 см", "width_mm": 130, "height_mm": 180},
    {"id": "15x21", "name": "15x21 см", "width_mm": 150, "height_mm": 210},
    {"id": "20x30", "name": "20x30 см", "width_mm": 200, "height_mm": 300},
    {"id": "A4", "name": "A4", "width_mm": 210, "height_mm": 297},
    {"id": "A5", "name": "A5", "width_mm": 148, "height_mm": 210},
    {"id": "A6", "name": "A6", "width_mm": 105, "height_mm": 148}
  ],
  "quality_modes": [
    {"id": "draft", "name": "Черновик"},
    {"id": "normal", "name": "Стандарт"},
    {"id": "photo", "name": "Фото"},
    {"id": "best", "name": "Лучшее фото"}
  ]
}'::jsonb
WHERE id = 'd6d0ecdb-30e5-4155-aebe-b83af65fd1d6';

-- Epson L8050 левый (id: 8d8e2a14-4fbe-4bb3-b0d4-9eb582115f0c)
UPDATE printers SET capabilities = '{
  "color": true,
  "duplex": false,
  "max_dpi": 5760,
  "borderless": true,
  "ppm": 8,
  "max_gsm": 300,
  "ink_count": 6,
  "ink_type": "dye",
  "ink_system": "CISS",
  "finishing": [],
  "media_types": [
    {"id": "glossy", "name": "Глянцевая"},
    {"id": "semi_glossy", "name": "Полуглянцевая"},
    {"id": "matte", "name": "Матовая"},
    {"id": "luster", "name": "Люстр"},
    {"id": "plain", "name": "Обычная"}
  ],
  "paper_sizes": [
    {"id": "10x15", "name": "10x15 см", "width_mm": 100, "height_mm": 150},
    {"id": "13x18", "name": "13x18 см", "width_mm": 130, "height_mm": 180},
    {"id": "15x21", "name": "15x21 см", "width_mm": 150, "height_mm": 210},
    {"id": "20x30", "name": "20x30 см", "width_mm": 200, "height_mm": 300},
    {"id": "A4", "name": "A4", "width_mm": 210, "height_mm": 297},
    {"id": "A5", "name": "A5", "width_mm": 148, "height_mm": 210},
    {"id": "A6", "name": "A6", "width_mm": 105, "height_mm": 148}
  ],
  "quality_modes": [
    {"id": "draft", "name": "Черновик"},
    {"id": "normal", "name": "Стандарт"},
    {"id": "photo", "name": "Фото"},
    {"id": "best", "name": "Лучшее фото"}
  ]
}'::jsonb
WHERE id = '8d8e2a14-4fbe-4bb3-b0d4-9eb582115f0c';

-- Epson L8050 правый (id: b39fc4b4-ace0-46a5-a9c1-e7d4d00dee62)
UPDATE printers SET capabilities = '{
  "color": true,
  "duplex": false,
  "max_dpi": 5760,
  "borderless": true,
  "ppm": 8,
  "max_gsm": 300,
  "ink_count": 6,
  "ink_type": "dye",
  "ink_system": "CISS",
  "finishing": [],
  "media_types": [
    {"id": "glossy", "name": "Глянцевая"},
    {"id": "semi_glossy", "name": "Полуглянцевая"},
    {"id": "matte", "name": "Матовая"},
    {"id": "luster", "name": "Люстр"},
    {"id": "plain", "name": "Обычная"}
  ],
  "paper_sizes": [
    {"id": "10x15", "name": "10x15 см", "width_mm": 100, "height_mm": 150},
    {"id": "13x18", "name": "13x18 см", "width_mm": 130, "height_mm": 180},
    {"id": "15x21", "name": "15x21 см", "width_mm": 150, "height_mm": 210},
    {"id": "20x30", "name": "20x30 см", "width_mm": 200, "height_mm": 300},
    {"id": "A4", "name": "A4", "width_mm": 210, "height_mm": 297},
    {"id": "A5", "name": "A5", "width_mm": 148, "height_mm": 210},
    {"id": "A6", "name": "A6", "width_mm": 105, "height_mm": 148}
  ],
  "quality_modes": [
    {"id": "draft", "name": "Черновик"},
    {"id": "normal", "name": "Стандарт"},
    {"id": "photo", "name": "Фото"},
    {"id": "best", "name": "Лучшее фото"}
  ]
}'::jsonb
WHERE id = 'b39fc4b4-ace0-46a5-a9c1-e7d4d00dee62';

-- Epson SC-F100 (id: 51a5e090-07e3-4e35-bcac-14038812c75d)
UPDATE printers SET capabilities = '{
  "color": true,
  "duplex": false,
  "max_dpi": 5760,
  "borderless": false,
  "ppm": 4,
  "max_gsm": 120,
  "ink_count": 4,
  "ink_type": "sublimation_dye",
  "sublimation": true,
  "mirror_default": true,
  "finishing": [],
  "media_types": [
    {"id": "sublimation", "name": "Сублимационная"},
    {"id": "ds_transfer", "name": "DS Transfer General Purpose"},
    {"id": "ds_transfer_rigid", "name": "DS Transfer Rigid"},
    {"id": "plain", "name": "Обычная"}
  ],
  "paper_sizes": [
    {"id": "A4", "name": "A4", "width_mm": 210, "height_mm": 297},
    {"id": "A5", "name": "A5", "width_mm": 148, "height_mm": 210},
    {"id": "A6", "name": "A6", "width_mm": 105, "height_mm": 148}
  ],
  "quality_modes": [
    {"id": "standard", "name": "Стандарт"},
    {"id": "high", "name": "Высокое"}
  ]
}'::jsonb
WHERE id = '51a5e090-07e3-4e35-bcac-14038812c75d';


-- ============================================================
-- 8. INSERT new presets (ON CONFLICT slug DO UPDATE)
-- ============================================================

-- Canon MF655CDw presets (printer_id: 877f10f9-b865-49cb-82b5-d0dd227e84d2)
INSERT INTO print_presets (id, slug, name, icon, printer_type, paper_size, media_type, quality, color_mode, duplex, borderless, fit_mode, sort_order, is_active)
VALUES
  (gen_random_uuid(), 'mf655-a4-color', 'MF655 A4 Цвет', 'palette', 'mfp', 'A4', 'plain', 'normal', 'color', false, false, 'fit', 50, true),
  (gen_random_uuid(), 'mf655-a4-bw', 'MF655 A4 Ч/Б', 'contrast', 'mfp', 'A4', 'plain', 'normal', 'bw', false, false, 'fit', 51, true),
  (gen_random_uuid(), 'mf655-a4-color-dup', 'MF655 A4 Цвет Дуплекс', 'auto_stories', 'mfp', 'A4', 'plain', 'normal', 'color', true, false, 'fit', 52, true),
  (gen_random_uuid(), 'mf655-a4-bw-dup', 'MF655 A4 Ч/Б Дуплекс', 'menu_book', 'mfp', 'A4', 'plain', 'normal', 'bw', true, false, 'fit', 53, true)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  icon = EXCLUDED.icon,
  printer_type = EXCLUDED.printer_type,
  paper_size = EXCLUDED.paper_size,
  media_type = EXCLUDED.media_type,
  quality = EXCLUDED.quality,
  color_mode = EXCLUDED.color_mode,
  duplex = EXCLUDED.duplex,
  borderless = EXCLUDED.borderless,
  fit_mode = EXCLUDED.fit_mode,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

-- Epson SC-F100 presets (printer_id: 51a5e090-07e3-4e35-bcac-14038812c75d)
INSERT INTO print_presets (id, slug, name, icon, printer_type, sublimation, paper_size, media_type, quality, color_mode, borderless, mirror, fit_mode, sort_order, is_active)
VALUES
  (gen_random_uuid(), 'scf100-a4-sub', 'SC-F100 A4 Сублимация', 'local_fire_department', 'photo', true, 'A4', 'sublimation', 'high', 'color', false, true, 'fit', 60, true),
  (gen_random_uuid(), 'scf100-a5-sub', 'SC-F100 A5 Сублимация', 'local_fire_department', 'photo', true, 'A5', 'sublimation', 'high', 'color', false, true, 'fit', 61, true)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  icon = EXCLUDED.icon,
  printer_type = EXCLUDED.printer_type,
  sublimation = EXCLUDED.sublimation,
  paper_size = EXCLUDED.paper_size,
  media_type = EXCLUDED.media_type,
  quality = EXCLUDED.quality,
  color_mode = EXCLUDED.color_mode,
  borderless = EXCLUDED.borderless,
  mirror = EXCLUDED.mirror,
  fit_mode = EXCLUDED.fit_mode,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

-- Epson L8050 new presets
INSERT INTO print_presets (id, slug, name, icon, printer_type, paper_size, media_type, quality, color_mode, borderless, fit_mode, sort_order, is_active)
VALUES
  (gen_random_uuid(), 'l8050-20x30', '20x30 Фото', 'panorama', 'photo', '20x30', 'glossy', 'photo', 'color', true, 'fill', 20, true),
  (gen_random_uuid(), 'l8050-10x15-matte', '10x15 Матовая', 'photo_filter', 'photo', '10x15', 'matte', 'photo', 'color', true, 'fill', 21, true),
  (gen_random_uuid(), 'l8050-a4-matte', 'A4 Матовая', 'filter', 'photo', 'A4', 'matte', 'photo', 'color', false, 'fit', 22, true)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  icon = EXCLUDED.icon,
  printer_type = EXCLUDED.printer_type,
  paper_size = EXCLUDED.paper_size,
  media_type = EXCLUDED.media_type,
  quality = EXCLUDED.quality,
  color_mode = EXCLUDED.color_mode,
  borderless = EXCLUDED.borderless,
  fit_mode = EXCLUDED.fit_mode,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

COMMIT;
