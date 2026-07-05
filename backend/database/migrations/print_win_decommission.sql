-- Phase 5: Windows Decommission — удаление win_printer_name
-- Все станции мигрированы на Ubuntu/CUPS, Windows print больше не используется

BEGIN;

-- 1. Дропаем VIEW (зависит от win_printer_name)
DROP VIEW IF EXISTS printer_current_status;

-- 2. Удаляем колонку win_printer_name из printers
ALTER TABLE printers DROP COLUMN IF EXISTS win_printer_name;

-- 3. Пересоздаём VIEW без win_printer_name
CREATE VIEW printer_current_status AS
SELECT DISTINCT ON (pt.printer_id)
    pt.id,
    pt.printer_id,
    pt.studio_id,
    pt.bridge_device_id,
    pt.is_online,
    pt.state,
    pt.state_reasons,
    pt.supplies,
    pt.trays,
    pt.counters,
    pt.errors,
    pt.model,
    pt.manufacturer,
    pt.serial_number,
    pt.firmware_version,
    pt.collected_at,
    pt.consumable_usage,
    p.name AS printer_name,
    p.printer_type,
    p.cups_printer_name,
    bd.name AS bridge_name,
    bd.is_online AS bridge_online,
    bd.agent_type
FROM printer_telemetry pt
JOIN printers p ON p.id = pt.printer_id
LEFT JOIN bridge_devices bd ON bd.id = pt.bridge_device_id
ORDER BY pt.printer_id, pt.collected_at DESC;

COMMIT;
