-- Migration 074: PC MagnusPhoto relocated from Barrikadnaya to Soborniy
-- Context: Only the PC moved, NOT the printers. Barrikadnaya printers stay there but deactivated (no PC).
-- Bridge device (print agent on PC) moves to Soborniy. Barrikadnaya studio → closed.
-- Idempotent: safe to re-run

BEGIN;

-- ============================================================
-- 1. Barrikadnaya printers: stay at Barrikadnaya, deactivate (no PC to drive them)
-- ============================================================

-- Canon MF655CDw — stays at Barrikadnaya, deactivated
UPDATE printers
SET is_active = false
WHERE id = '877f10f9-b865-49cb-82b5-d0dd227e84d2'
  AND studio_id = 'a16b2e19-8c31-42b4-88f6-aa2cce3c1b69';

-- Epson L8050 — stays at Barrikadnaya, deactivated
UPDATE printers
SET is_active = false
WHERE id = 'd6d0ecdb-30e5-4155-aebe-b83af65fd1d6'
  AND studio_id = 'a16b2e19-8c31-42b4-88f6-aa2cce3c1b69';

-- ============================================================
-- 2. Update Canon MF655CDw capabilities (complete specs for when it comes online)
-- ============================================================

UPDATE printers
SET capabilities = jsonb_build_object(
  'ppm', 21,
  'color', true,
  'duplex', true,
  'max_dpi', 1200,
  'max_gsm', 163,
  'ink_type', 'toner',
  'ink_count', 4,
  'borderless', false,
  'adf', true,
  'adf_duplex', true,
  'adf_capacity', 50,
  'finishing', '[]'::jsonb,
  'media_types', '[
    {"id": "plain", "name": "Обычная"},
    {"id": "thick", "name": "Плотная"},
    {"id": "heavy", "name": "Тяжёлая 91-105 г/м²"},
    {"id": "labels", "name": "Этикетки"},
    {"id": "envelope", "name": "Конверт"},
    {"id": "coated", "name": "Мелованная"}
  ]'::jsonb,
  'paper_sizes', '[
    {"id": "A4", "name": "A4", "width_mm": 210, "height_mm": 297},
    {"id": "A5", "name": "A5", "width_mm": 148, "height_mm": 210},
    {"id": "B5", "name": "B5", "width_mm": 176, "height_mm": 250},
    {"id": "Legal", "name": "Legal", "width_mm": 216, "height_mm": 356},
    {"id": "Letter", "name": "Letter", "width_mm": 216, "height_mm": 279},
    {"id": "Executive", "name": "Executive", "width_mm": 184, "height_mm": 267}
  ]'::jsonb,
  'paper_sources', '[
    {"id": "auto", "name": "Авто"},
    {"id": "tray1", "name": "Лоток 1 (250 листов)"},
    {"id": "universal", "name": "Универсальный лоток (1 лист)"},
    {"id": "adf", "name": "АПД (50 листов)"}
  ]'::jsonb,
  'quality_modes', '[
    {"id": "draft", "name": "Черновик"},
    {"id": "normal", "name": "Стандарт"},
    {"id": "high", "name": "Высокое"}
  ]'::jsonb
)
WHERE id = '877f10f9-b865-49cb-82b5-d0dd227e84d2';

-- ============================================================
-- 3. Relocate bridge_device (print agent on PC) → Soborniy
-- ============================================================

UPDATE bridge_devices
SET studio_id = '30ef357f-06a6-4b01-b1ff-dbbe7eaed446',
    name = 'Соборный 21 — Print Agent (ex-Баррикадная)'
WHERE id = 'b0000002-0000-0000-0000-000000000002'
  AND studio_id = 'a16b2e19-8c31-42b4-88f6-aa2cce3c1b69';

-- ============================================================
-- 4. Studio Barrikadnaya → closed (no PC, printers deactivated)
-- ============================================================

UPDATE studios
SET status = 'closed',
    status_message = 'Адрес не работает. Оборудование перенесено на Соборный 21.'
WHERE id = 'a16b2e19-8c31-42b4-88f6-aa2cce3c1b69'
  AND status != 'closed';

-- ============================================================
-- 5. Historical data: DO NOT touch
-- ============================================================

-- print_jobs, printer_telemetry, print_printer_daily: studio_id stays Barrikadnaya

-- ============================================================
-- 6. Verification
-- ============================================================

DO $$
DECLARE
  v_count integer;
BEGIN
  -- Verify Barrikadnaya printers deactivated
  SELECT COUNT(*) INTO v_count FROM printers
  WHERE id IN ('877f10f9-b865-49cb-82b5-d0dd227e84d2', 'd6d0ecdb-30e5-4155-aebe-b83af65fd1d6')
    AND studio_id = 'a16b2e19-8c31-42b4-88f6-aa2cce3c1b69'
    AND is_active = false;
  IF v_count != 2 THEN
    RAISE EXCEPTION 'Verification failed: expected 2 deactivated printers at Barrikadnaya, got %', v_count;
  END IF;

  -- Verify Soborniy has 4 active printers
  SELECT COUNT(*) INTO v_count FROM printers
  WHERE studio_id = '30ef357f-06a6-4b01-b1ff-dbbe7eaed446'
    AND is_active = true;
  IF v_count != 4 THEN
    RAISE EXCEPTION 'Verification failed: expected 4 active printers at Soborniy, got %', v_count;
  END IF;

  -- Verify bridge moved
  SELECT COUNT(*) INTO v_count FROM bridge_devices
  WHERE id = 'b0000002-0000-0000-0000-000000000002'
    AND studio_id = '30ef357f-06a6-4b01-b1ff-dbbe7eaed446';
  IF v_count != 1 THEN
    RAISE EXCEPTION 'Verification failed: bridge device not at Soborniy';
  END IF;

  RAISE NOTICE 'Migration 074 verified: Barrikadnaya printers deactivated, Soborniy has 4 active, bridge moved';
END $$;

COMMIT;
