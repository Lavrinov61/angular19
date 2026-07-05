-- Лёгкие смены без фискализации
-- 2026-03-26

-- 1. fiscal_enabled на смене (default true — обратная совместимость)
ALTER TABLE pos_shifts ADD COLUMN IF NOT EXISTS fiscal_enabled BOOLEAN NOT NULL DEFAULT true;

-- 2. shift_id NULLABLE — чеки из чата (Payment Dialog) без кассовой смены
ALTER TABLE pos_receipts ALTER COLUMN shift_id DROP NOT NULL;
