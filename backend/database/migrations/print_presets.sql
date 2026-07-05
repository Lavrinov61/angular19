-- Print Presets: predefined print configurations
-- Idempotent migration

CREATE TABLE IF NOT EXISTS print_presets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    icon VARCHAR(50) NOT NULL DEFAULT 'print',
    printer_type VARCHAR(20) NOT NULL CHECK (printer_type IN ('photo', 'mfp', 'document')),
    sublimation BOOLEAN NOT NULL DEFAULT FALSE,
    paper_size VARCHAR(30) NOT NULL DEFAULT 'A4',
    media_type VARCHAR(50),
    quality VARCHAR(30) NOT NULL DEFAULT 'normal',
    fit_mode VARCHAR(20) NOT NULL DEFAULT 'fit' CHECK (fit_mode IN ('fit', 'fill', 'stretch', 'actual')),
    borderless BOOLEAN NOT NULL DEFAULT FALSE,
    color_mode VARCHAR(10) NOT NULL DEFAULT 'color' CHECK (color_mode IN ('color', 'bw')),
    duplex BOOLEAN NOT NULL DEFAULT FALSE,
    mirror BOOLEAN NOT NULL DEFAULT FALSE,
    price DOUBLE PRECISION NOT NULL DEFAULT 0,
    sort_order INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID REFERENCES users(id),
    studio_id UUID REFERENCES studios(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_print_presets_active ON print_presets(is_active) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_print_presets_printer_type ON print_presets(printer_type);

-- Seed 8 standard presets
INSERT INTO print_presets (id, name, icon, printer_type, sublimation, paper_size, media_type, quality, fit_mode, borderless, color_mode, duplex, mirror, price, sort_order)
VALUES
    (gen_random_uuid(), 'Фото 10x15', 'photo', 'photo', FALSE, '10x15', 'glossy', 'photo', 'fill', TRUE, 'color', FALSE, FALSE, 50.00, 1),
    (gen_random_uuid(), '10x15 матовая', 'photo', 'photo', FALSE, '10x15', 'matte', 'photo', 'fill', TRUE, 'color', FALSE, FALSE, 50.00, 2),
    (gen_random_uuid(), 'Фото 13x18', 'photo', 'photo', FALSE, '13x18', 'glossy', 'photo', 'fill', TRUE, 'color', FALSE, FALSE, 80.00, 3),
    (gen_random_uuid(), 'Фото A4', 'photo', 'photo', FALSE, 'A4', 'glossy', 'photo', 'fill', TRUE, 'color', FALSE, FALSE, 150.00, 4),
    (gen_random_uuid(), 'Документ A4', 'description', 'mfp', FALSE, 'A4', NULL, 'normal', 'fit', FALSE, 'color', FALSE, FALSE, 20.00, 5),
    (gen_random_uuid(), 'A4 Ч/Б', 'contrast', 'mfp', FALSE, 'A4', NULL, 'normal', 'fit', FALSE, 'bw', FALSE, FALSE, 15.00, 6),
    (gen_random_uuid(), 'Двусторонний', 'flip', 'mfp', FALSE, 'A4', NULL, 'normal', 'fit', FALSE, 'color', TRUE, FALSE, 20.00, 7),
    (gen_random_uuid(), 'Сублимация', 'local_fire_department', 'photo', TRUE, 'A4', 'ds_transfer', 'standard', 'fill', FALSE, 'color', FALSE, TRUE, 100.00, 8)
ON CONFLICT DO NOTHING;
