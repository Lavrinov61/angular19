-- printer_names_v2.sql — заполнить cups_printer_name + добавить второй L8050 на Соборном
-- 6 принтеров: Баррикадная (2), Соборный (4)

-- 1. Баррикадная: Epson L8050
UPDATE printers SET cups_printer_name = 'EPSON L8050 Series'
WHERE name = 'Epson L8050' AND studio_id = (SELECT id FROM studios WHERE name ILIKE '%Баррикадная%' LIMIT 1);

-- 2. Баррикадная: Canon MF655CDw
UPDATE printers SET cups_printer_name = 'MF650C Series'
WHERE name = 'Canon MF655CDw' AND studio_id = (SELECT id FROM studios WHERE name ILIKE '%Баррикадная%' LIMIT 1);

-- 3. Соборный: переименовать текущий L8050 → "Epson L8050 левый"
UPDATE printers SET name = 'Epson L8050 левый', cups_printer_name = 'L8050 левый'
WHERE name = 'Epson L8050' AND studio_id = (SELECT id FROM studios WHERE name ILIKE '%Соборный%' LIMIT 1);

-- 4. Соборный: добавить второй L8050 (правый)
INSERT INTO printers (name, printer_type, studio_id, cups_printer_name, is_active, capabilities)
SELECT
  'Epson L8050 правый',
  'photo',
  s.id,
  'L8050 правый',
  TRUE,
  (SELECT capabilities FROM printers WHERE name = 'Epson L8050 левый' AND studio_id = s.id LIMIT 1)
FROM studios s
WHERE s.name ILIKE '%Соборный%'
AND NOT EXISTS (
  SELECT 1 FROM printers WHERE name = 'Epson L8050 правый' AND studio_id = s.id
);

-- 5. Соборный: Epson SC-F100
UPDATE printers SET cups_printer_name = 'EPSONCA4D0B (SC-F100 Series)'
WHERE name = 'Epson SC-F100' AND studio_id = (SELECT id FROM studios WHERE name ILIKE '%Соборный%' LIMIT 1);

-- 6. Соборный: Canon C3226i
UPDATE printers SET cups_printer_name = 'iR C3226(2)'
WHERE name = 'Canon C3226i' AND studio_id = (SELECT id FROM studios WHERE name ILIKE '%Соборный%' LIMIT 1);
