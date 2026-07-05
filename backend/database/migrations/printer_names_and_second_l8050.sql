-- Миграция: обновление cups_printer_name для всех принтеров + добавление второго L8050 на Соборный
-- Идемпотентна: INSERT с WHERE NOT EXISTS, UPDATE безопасны

BEGIN;

-- 1. Переименовать текущий L8050 на Соборном в "Epson L8050 левый"
UPDATE printers
SET name = 'Epson L8050 левый',
    cups_printer_name = 'L8050 левый'
WHERE id = '8d8e2a14-4fbe-4bb3-b0d4-9eb582115f0c';

-- 2. Добавить второй L8050 на Соборном ("правый")
INSERT INTO printers (id, name, printer_type, studio_id, cups_printer_name, capabilities, is_active)
SELECT
  gen_random_uuid(),
  'Epson L8050 правый',
  'photo',
  '30ef357f-06a6-4b01-b1ff-dbbe7eaed446',
  'L8050 правый',
  '{"color":true,"duplex":false,"max_dpi":5760,"borderless":true,"media_types":[{"id":"glossy","name":"Глянцевая"},{"id":"matte","name":"Матовая"},{"id":"satin","name":"Сатин/Полуглянец"},{"id":"luster","name":"Люстр"},{"id":"fine_art","name":"Fine Art"}],"paper_sizes":[{"id":"10x15","name":"10×15 см","width_mm":100,"height_mm":150},{"id":"13x18","name":"13×18 см","width_mm":130,"height_mm":180},{"id":"A4","name":"A4","width_mm":210,"height_mm":297},{"id":"A5","name":"A5","width_mm":148,"height_mm":210}],"quality_modes":[{"id":"draft","name":"Черновик"},{"id":"normal","name":"Стандарт"},{"id":"photo","name":"Фото"},{"id":"best","name":"Лучшее фото"}]}'::jsonb,
  true
WHERE NOT EXISTS (
  SELECT 1 FROM printers
  WHERE studio_id = '30ef357f-06a6-4b01-b1ff-dbbe7eaed446'
    AND name = 'Epson L8050 правый'
);

-- 3. Обновить cups_printer_name для Баррикадной
UPDATE printers SET cups_printer_name = 'EPSON L8050 Series'
WHERE id = 'd6d0ecdb-30e5-4155-aebe-b83af65fd1d6';

UPDATE printers SET cups_printer_name = 'MF650C Series'
WHERE id = '877f10f9-b865-49cb-82b5-d0dd227e84d2';

-- 4. Обновить cups_printer_name для Соборного (SC-F100, Canon C3226i)
UPDATE printers SET cups_printer_name = 'EPSONCA4D0B (SC-F100 Series)'
WHERE id = '51a5e090-07e3-4e35-bcac-14038812c75d';

UPDATE printers SET cups_printer_name = 'iR C3226(2)'
WHERE id = '49a1bd1a-c34d-49e9-9eaa-82e79357a177';

COMMIT;
