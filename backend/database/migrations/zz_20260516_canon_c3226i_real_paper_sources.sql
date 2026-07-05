-- Canon C3226i in the studio has two cassettes plus the universal tray.
-- The driver advertises optional cassettes 3-4, but they are not installed.

UPDATE printers
SET capabilities = jsonb_set(
  COALESCE(capabilities, '{}'::jsonb),
  '{paper_sources}',
  jsonb_build_array(
    jsonb_build_object('id', 'auto', 'name', 'Авто'),
    jsonb_build_object('id', 'manual', 'name', 'Универсальный лоток'),
    jsonb_build_object('id', 'cas1', 'name', 'Кассета 1'),
    jsonb_build_object('id', 'cas2', 'name', 'Кассета 2')
  ),
  true
)
WHERE name ILIKE '%C3226%'
   OR cups_printer_name ILIKE '%C3226%'
   OR cups_printer_name ILIKE '%iR C3226%';
