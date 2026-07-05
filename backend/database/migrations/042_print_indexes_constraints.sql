-- Migration: 042_print_indexes_constraints
-- Fix FK constraints (NO ACTION → ON DELETE SET NULL) and add missing composite index
-- Idempotent: uses DO $$ blocks with pg_constraint checks

-- ============================================================
-- 1. print_presets: FK constraints → ON DELETE SET NULL
-- ============================================================

-- 1a. print_presets.studio_id → studios(id) ON DELETE SET NULL
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'print_presets_studio_id_fkey'
        AND confdeltype = 'a'  -- 'a' = NO ACTION
    ) THEN
        ALTER TABLE print_presets DROP CONSTRAINT print_presets_studio_id_fkey;
        ALTER TABLE print_presets ADD CONSTRAINT print_presets_studio_id_fkey
            FOREIGN KEY (studio_id) REFERENCES studios(id) ON DELETE SET NULL;
    END IF;
END $$;

-- 1b. print_presets.created_by → users(id) ON DELETE SET NULL
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'print_presets_created_by_fkey'
        AND confdeltype = 'a'
    ) THEN
        ALTER TABLE print_presets DROP CONSTRAINT print_presets_created_by_fkey;
        ALTER TABLE print_presets ADD CONSTRAINT print_presets_created_by_fkey
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END $$;

-- ============================================================
-- 2. print_jobs: FK constraints → ON DELETE SET NULL
-- ============================================================

-- 2a. print_jobs.printer_id → printers(id) ON DELETE SET NULL
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'print_jobs_printer_id_fkey'
        AND confdeltype = 'a'
    ) THEN
        ALTER TABLE print_jobs DROP CONSTRAINT print_jobs_printer_id_fkey;
        ALTER TABLE print_jobs ADD CONSTRAINT print_jobs_printer_id_fkey
            FOREIGN KEY (printer_id) REFERENCES printers(id) ON DELETE SET NULL;
    END IF;
END $$;

-- 2b. print_jobs.created_by → users(id) ON DELETE SET NULL
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'print_jobs_created_by_fkey'
        AND confdeltype = 'a'
    ) THEN
        ALTER TABLE print_jobs DROP CONSTRAINT print_jobs_created_by_fkey;
        ALTER TABLE print_jobs ADD CONSTRAINT print_jobs_created_by_fkey
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END $$;

-- 2c. print_jobs.studio_id → studios(id) ON DELETE SET NULL
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'print_jobs_studio_id_fkey'
        AND confdeltype = 'a'
    ) THEN
        ALTER TABLE print_jobs DROP CONSTRAINT print_jobs_studio_id_fkey;
        ALTER TABLE print_jobs ADD CONSTRAINT print_jobs_studio_id_fkey
            FOREIGN KEY (studio_id) REFERENCES studios(id) ON DELETE SET NULL;
    END IF;
END $$;

-- 2d. print_jobs.reassigned_by → users(id) ON DELETE SET NULL
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'print_jobs_reassigned_by_fkey'
        AND confdeltype = 'a'
    ) THEN
        ALTER TABLE print_jobs DROP CONSTRAINT print_jobs_reassigned_by_fkey;
        ALTER TABLE print_jobs ADD CONSTRAINT print_jobs_reassigned_by_fkey
            FOREIGN KEY (reassigned_by) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END $$;

-- 2e. print_jobs.reassigned_from → printers(id) ON DELETE SET NULL
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'print_jobs_reassigned_from_fkey'
        AND confdeltype = 'a'
    ) THEN
        ALTER TABLE print_jobs DROP CONSTRAINT print_jobs_reassigned_from_fkey;
        ALTER TABLE print_jobs ADD CONSTRAINT print_jobs_reassigned_from_fkey
            FOREIGN KEY (reassigned_from) REFERENCES printers(id) ON DELETE SET NULL;
    END IF;
END $$;

-- ============================================================
-- 3. Missing composite index on print_presets
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_print_presets_studio_printer_type
    ON print_presets(studio_id, printer_type);
