-- ============================================================
-- Print Jobs — Интеграция принтеров Epson L8050 + Canon C3226i
-- Версия: v0.36.0 (2026-02-25)
-- ============================================================

CREATE TABLE IF NOT EXISTS printers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  printer_type VARCHAR(20) NOT NULL CHECK (printer_type IN ('photo','document','mfp')),
  win_printer_name VARCHAR(200) NOT NULL,  -- имя в Windows: 'EPSON L8050 Series'
  studio_id UUID REFERENCES studios(id) ON DELETE SET NULL,
  capabilities JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS print_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  printer_id UUID NOT NULL REFERENCES printers(id),
  file_url TEXT NOT NULL,
  file_name VARCHAR(255),
  -- Настройки печати (передаются bridge → .NET helper)
  copies INT DEFAULT 1 CHECK (copies >= 1 AND copies <= 999),
  paper_size VARCHAR(30) DEFAULT 'A4',
  color_mode VARCHAR(10) DEFAULT 'color' CHECK (color_mode IN ('color','bw')),
  quality VARCHAR(30) DEFAULT 'normal',
  duplex BOOLEAN DEFAULT FALSE,
  orientation VARCHAR(20) DEFAULT 'auto' CHECK (orientation IN ('portrait','landscape','auto')),
  borderless BOOLEAN DEFAULT FALSE,
  media_type VARCHAR(50),
  fit_mode VARCHAR(20) DEFAULT 'fit' CHECK (fit_mode IN ('fit','fill','stretch','actual')),
  -- Статус
  status VARCHAR(20) DEFAULT 'queued' CHECK (status IN ('queued','sending','printing','completed','failed','cancelled')),
  error_message TEXT,
  -- Связи
  order_id VARCHAR(100),
  order_type VARCHAR(30),
  receipt_id UUID,
  created_by UUID NOT NULL REFERENCES users(id),
  studio_id UUID REFERENCES studios(id),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON print_jobs(status) WHERE status IN ('queued','sending','printing');
CREATE INDEX IF NOT EXISTS idx_print_jobs_studio ON print_jobs(studio_id);
CREATE INDEX IF NOT EXISTS idx_print_jobs_created ON print_jobs(created_at DESC);

-- ──────────────────────────────────────────────────────────
-- Seed: Epson L8050 + Canon C3226i
-- ──────────────────────────────────────────────────────────

INSERT INTO printers (name, printer_type, win_printer_name, studio_id, capabilities)
SELECT
  'Epson L8050',
  'photo',
  'EPSON L8050 Series',
  (SELECT id FROM studios ORDER BY created_at LIMIT 1),
  '{
    "paper_sizes": [
      {"id":"10x15","name":"10×15 см","width_mm":100,"height_mm":150},
      {"id":"13x18","name":"13×18 см","width_mm":130,"height_mm":180},
      {"id":"A4","name":"A4","width_mm":210,"height_mm":297},
      {"id":"A5","name":"A5","width_mm":148,"height_mm":210}
    ],
    "media_types": [
      {"id":"glossy","name":"Глянцевая"},
      {"id":"matte","name":"Матовая"},
      {"id":"satin","name":"Сатин/Полуглянец"},
      {"id":"luster","name":"Люстр"},
      {"id":"fine_art","name":"Fine Art"}
    ],
    "quality_modes": [
      {"id":"draft","name":"Черновик"},
      {"id":"normal","name":"Стандарт"},
      {"id":"photo","name":"Фото"},
      {"id":"best","name":"Лучшее фото"}
    ],
    "color": true, "duplex": false, "borderless": true, "max_dpi": 5760
  }'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM printers WHERE win_printer_name = 'EPSON L8050 Series');

INSERT INTO printers (name, printer_type, win_printer_name, studio_id, capabilities)
SELECT
  'Canon C3226i',
  'mfp',
  'Canon C3226i',
  (SELECT id FROM studios ORDER BY created_at LIMIT 1),
  '{
    "paper_sizes": [
      {"id":"A4","name":"A4","width_mm":210,"height_mm":297},
      {"id":"A3","name":"A3","width_mm":297,"height_mm":420},
      {"id":"A5","name":"A5","width_mm":148,"height_mm":210}
    ],
    "media_types": [
      {"id":"plain","name":"Обычная"},
      {"id":"thick","name":"Плотная"},
      {"id":"recycled","name":"Переработанная"},
      {"id":"envelope","name":"Конверт"}
    ],
    "quality_modes": [
      {"id":"draft","name":"Черновик"},
      {"id":"normal","name":"Стандарт"},
      {"id":"high","name":"Высокое качество"}
    ],
    "color": true, "duplex": true, "borderless": false, "max_dpi": 1200
  }'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM printers WHERE win_printer_name = 'Canon C3226i');
