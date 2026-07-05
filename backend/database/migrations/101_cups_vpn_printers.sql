-- Migration 101: Activate Barrikadnaya printers with real CUPS names for VPN printing
-- Idempotent: safe to run multiple times

BEGIN;

-- 1. Activate Canon MF655CDw and update CUPS printer name
UPDATE printers
SET is_active = TRUE,
    cups_printer_name = 'Canon-MF655CDw'
WHERE id = '877f10f9-b865-49cb-82b5-d0dd227e84d2';

-- 2. Activate Epson L8050 and update CUPS printer name
UPDATE printers
SET is_active = TRUE,
    cups_printer_name = 'Epson-L8050-Barrikadnaya'
WHERE id = 'd6d0ecdb-30e5-4155-aebe-b83af65fd1d6';

-- 3. Add photo presets for Barrikadnaya studio (10x15, 15x20, 20x30)
--    printer_type = 'photo' for Epson L8050
--    studio_id = Barrikadnaya

INSERT INTO print_presets (
    name, icon, printer_type, sublimation, paper_size, media_type,
    quality, fit_mode, borderless, color_mode, duplex, mirror,
    price, sort_order, is_active, studio_id
) VALUES
    -- 10x15 glossy
    ('10x15 Фото', 'photo', 'photo', false, '10x15', 'glossy',
     'photo', 'fill', true, 'color', false, false,
     10.00, 1, true, 'a16b2e19-8c31-42b4-88f6-aa2cce3c1b69'),
    -- 10x15 matte
    ('10x15 Матовая', 'photo', 'photo', false, '10x15', 'matte',
     'photo', 'fill', true, 'color', false, false,
     10.00, 2, true, 'a16b2e19-8c31-42b4-88f6-aa2cce3c1b69'),
    -- 15x20 glossy (closest CUPS size: 15x21 / 5x7)
    ('15x20 Фото', 'photo', 'photo', false, '15x20', 'glossy',
     'photo', 'fill', true, 'color', false, false,
     30.00, 3, true, 'a16b2e19-8c31-42b4-88f6-aa2cce3c1b69'),
    -- 15x20 matte
    ('15x20 Матовая', 'photo', 'photo', false, '15x20', 'matte',
     'photo', 'fill', true, 'color', false, false,
     30.00, 4, true, 'a16b2e19-8c31-42b4-88f6-aa2cce3c1b69'),
    -- 20x30 glossy
    ('20x30 Фото', 'photo', 'photo', false, '20x30', 'glossy',
     'photo', 'fill', true, 'color', false, false,
     50.00, 5, true, 'a16b2e19-8c31-42b4-88f6-aa2cce3c1b69'),
    -- 20x30 matte
    ('20x30 Матовая', 'photo', 'photo', false, '20x30', 'matte',
     'photo', 'fill', true, 'color', false, false,
     50.00, 6, true, 'a16b2e19-8c31-42b4-88f6-aa2cce3c1b69')
ON CONFLICT DO NOTHING;

-- 4. Add 15x20 paper size to Epson L8050 capabilities if missing
UPDATE printers
SET capabilities = jsonb_set(
    capabilities,
    '{paper_sizes}',
    (
        SELECT CASE
            WHEN NOT EXISTS (
                SELECT 1 FROM jsonb_array_elements(capabilities->'paper_sizes') elem
                WHERE elem->>'id' = '15x20'
            )
            THEN (capabilities->'paper_sizes') || '[{"id":"15x20","name":"15x20 cm","width_mm":150,"height_mm":200}]'::jsonb
            ELSE capabilities->'paper_sizes'
        END
        FROM printers WHERE id = 'd6d0ecdb-30e5-4155-aebe-b83af65fd1d6'
    )
)
WHERE id = 'd6d0ecdb-30e5-4155-aebe-b83af65fd1d6';

COMMIT;
