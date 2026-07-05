-- Migration 129: SC-F100 остаётся на Windows-пути
-- Date: 2026-04-20
-- Контекст: SureColor SC-F100 не имеет нативного Linux CUPS-драйвера.
-- Установить cups_printer_name = NULL → print-api при обработке этого принтера
-- пропускает CUPS-ветку (mqtt/publisher.rs:132) и отправляет задание через MQTT
-- к Windows-агенту на ПК MagnusPhoto в Соборном.
--
-- CUPS-очередь Epson-SC-F100-Soborny (RAW socket) удалена вручную через
-- `lpadmin -x`. Миграция 128 поставила ей cups_printer_name; откат здесь.
--
-- 3 других принтера Соборного (Canon C3226i, оба L8050) — остаются на Linux CUPS
-- с cups_printer_name из миграции 128.

BEGIN;

UPDATE printers
SET cups_printer_name = NULL
WHERE id = '51a5e090-07e3-4e35-bcac-14038812c75d'
  AND cups_printer_name IS NOT NULL;

COMMIT;

-- Итоговое состояние Соборного
SELECT name, cups_printer_name
FROM printers
WHERE studio_id = '30ef357f-06a6-4b01-b1ff-dbbe7eaed446'
ORDER BY name;
