-- Add rotation column to print_jobs for exact image rotation (0, 90, 180, 270)
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS rotation smallint DEFAULT 0;
COMMENT ON COLUMN print_jobs.rotation IS 'Image rotation in degrees (0, 90, 180, 270)';
