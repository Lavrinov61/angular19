-- Migration 083: Add mirror and crop fields to print_jobs
BEGIN;

ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS mirror BOOLEAN DEFAULT FALSE;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS crop_x REAL;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS crop_y REAL;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS crop_width REAL;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS crop_height REAL;

COMMIT;
