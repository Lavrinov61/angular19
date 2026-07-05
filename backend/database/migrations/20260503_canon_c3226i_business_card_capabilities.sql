-- Canon C3226i business-card capabilities.
-- No print_presets are inserted here: business-card price must be configured in API/DB.

UPDATE printers
SET capabilities = COALESCE(capabilities, '{}'::jsonb)
  || jsonb_build_object(
    'color', true,
    'duplex', true,
    'borderless', false,
    'max_dpi', 600,
    'max_gsm', 256,
    'supported_resolutions', jsonb_build_array(600),
    'paper_sizes', jsonb_build_array(
      jsonb_build_object('id', 'A3', 'name', 'A3', 'width_mm', 297, 'height_mm', 420),
      jsonb_build_object('id', 'A4', 'name', 'A4', 'width_mm', 210, 'height_mm', 297),
      jsonb_build_object('id', 'A5', 'name', 'A5', 'width_mm', 148, 'height_mm', 210),
      jsonb_build_object('id', 'A6', 'name', 'A6', 'width_mm', 105, 'height_mm', 148),
      jsonb_build_object('id', 'B4', 'name', 'B4', 'width_mm', 250, 'height_mm', 353),
      jsonb_build_object('id', 'B5', 'name', 'B5', 'width_mm', 176, 'height_mm', 250),
      jsonb_build_object('id', 'Letter', 'name', 'Letter', 'width_mm', 216, 'height_mm', 279),
      jsonb_build_object('id', 'Legal', 'name', 'Legal', 'width_mm', 216, 'height_mm', 356)
    ),
    'paper_sources', jsonb_build_array(
      jsonb_build_object('id', 'auto', 'name', 'Авто'),
      jsonb_build_object('id', 'manual', 'name', 'Универсальный лоток'),
      jsonb_build_object('id', 'cas1', 'name', 'Кассета 1'),
      jsonb_build_object('id', 'cas2', 'name', 'Кассета 2'),
      jsonb_build_object('id', 'cas3', 'name', 'Кассета 3'),
      jsonb_build_object('id', 'cas4', 'name', 'Кассета 4')
    ),
    'media_types', jsonb_build_array(
      jsonb_build_object('id', 'plain', 'name', 'Обычная'),
      jsonb_build_object('id', 'plain2', 'name', 'Обычная 2'),
      jsonb_build_object('id', 'plain3', 'name', 'Обычная 3'),
      jsonb_build_object('id', 'recycled', 'name', 'Переработанная'),
      jsonb_build_object('id', 'heavy1', 'name', 'Плотная 1'),
      jsonb_build_object('id', 'heavy2', 'name', 'Плотная 2'),
      jsonb_build_object('id', 'heavy3', 'name', 'Плотная 3'),
      jsonb_build_object('id', 'heavy4', 'name', 'Плотная 4'),
      jsonb_build_object('id', 'heavy5', 'name', 'Плотная 5'),
      jsonb_build_object('id', 'heavy6', 'name', 'Плотная 6 / 221-256 г/м2'),
      jsonb_build_object('id', 'heavy7', 'name', 'Плотная 7'),
      jsonb_build_object('id', 'labels', 'name', 'Этикетки'),
      jsonb_build_object('id', 'coated', 'name', 'Мелованная')
    ),
    'quality_modes', jsonb_build_array(
      jsonb_build_object('id', 'draft', 'name', 'Черновик'),
      jsonb_build_object('id', 'normal', 'name', 'Стандарт'),
      jsonb_build_object('id', 'high', 'name', 'Высокое качество')
    )
  )
WHERE name ILIKE '%C3226%'
   OR cups_printer_name ILIKE '%C3226%'
   OR cups_printer_name ILIKE '%iR C3226%';
