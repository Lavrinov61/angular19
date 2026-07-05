-- Migration 128: Linux CUPS printer names for Соборный 21
-- Date: 2026-04-20
-- Контекст: после перехода с печати через Windows-ПК (GDI/win_print.rs) на прямые
-- Linux-очереди CUPS на prod-сервере через WireGuard-туннель до Соборного 21.
-- CUPS-очереди созданы на 84.38.189.58: Canon-C3226i-Soborny (.146, UFR II PPD),
-- Epson-L8050-Left-Soborny (.71, ESC/P-R2), Epson-L8050-Right-Soborny (.92, ESC/P-R2),
-- Epson-SC-F100-Soborny (.140, RAW socket — Linux-драйвера нет).
-- Print-api :3004 с CUPS_ENABLED=true при ненулевом cups_printer_name печатает
-- через `lp` локально, MQTT/print-agent не задействуется.
--
-- ВАЖНО: какой L8050 физически «левый», какой «правый» — не проверено на месте.
-- Маппинг 192.168.1.71 → левый, 192.168.1.92 → правый — условный.
-- Если после smoke-теста выяснится обратное, делаем swap lpadmin -v на ip-адрес
-- без изменения этой миграции (имена очередей остаются).
--
-- Баррикадная не трогается (peer деактивирован в 074, cups_printer_name уже ок).

BEGIN;

UPDATE printers
SET cups_printer_name = 'Canon-C3226i-Soborny'
WHERE id = '49a1bd1a-c34d-49e9-9eaa-82e79357a177'
  AND cups_printer_name IS DISTINCT FROM 'Canon-C3226i-Soborny';

UPDATE printers
SET cups_printer_name = 'Epson-L8050-Left-Soborny'
WHERE id = '8d8e2a14-4fbe-4bb3-b0d4-9eb582115f0c'
  AND cups_printer_name IS DISTINCT FROM 'Epson-L8050-Left-Soborny';

UPDATE printers
SET cups_printer_name = 'Epson-L8050-Right-Soborny'
WHERE id = 'b39fc4b4-ace0-46a5-a9c1-e7d4d00dee62'
  AND cups_printer_name IS DISTINCT FROM 'Epson-L8050-Right-Soborny';

UPDATE printers
SET cups_printer_name = 'Epson-SC-F100-Soborny'
WHERE id = '51a5e090-07e3-4e35-bcac-14038812c75d'
  AND cups_printer_name IS DISTINCT FROM 'Epson-SC-F100-Soborny';

COMMIT;

-- Проверка результата
SELECT id, name, cups_printer_name, printer_type
FROM printers
WHERE studio_id = '30ef357f-06a6-4b01-b1ff-dbbe7eaed446'
ORDER BY name;
