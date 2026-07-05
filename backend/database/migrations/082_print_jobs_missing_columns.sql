-- Migration 082: Add missing columns to print_jobs (hold, pause, schedule, finishing)
BEGIN;

-- 1. New columns
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS held_by UUID;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS held_at TIMESTAMPTZ;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS released_by UUID;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS finishing_status VARCHAR(20) DEFAULT 'none';
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS finishing_notes TEXT;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS paused_by UUID;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ;

-- 2. Status CHECK constraint with 14 statuses
ALTER TABLE print_jobs DROP CONSTRAINT IF EXISTS print_jobs_status_check;
ALTER TABLE print_jobs ADD CONSTRAINT print_jobs_status_check
  CHECK (status IN ('queued','sending','applying_icc','rendering_layout','printing',
    'completed','failed','cancelled','converting','paused','held','scheduled','splitting','finishing'));

-- 3. updated_at trigger
CREATE OR REPLACE FUNCTION update_print_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_print_jobs_updated_at ON print_jobs;
CREATE TRIGGER trg_print_jobs_updated_at
  BEFORE UPDATE ON print_jobs
  FOR EACH ROW EXECUTE FUNCTION update_print_jobs_updated_at();

-- 4. Partial indexes
CREATE INDEX IF NOT EXISTS idx_print_jobs_scheduled_at ON print_jobs(scheduled_at) WHERE scheduled_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_print_jobs_held_at ON print_jobs(held_at) WHERE held_at IS NOT NULL;

COMMIT;
