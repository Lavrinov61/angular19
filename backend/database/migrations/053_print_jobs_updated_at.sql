-- Migration 053: Add updated_at to print_jobs + auto-update trigger
BEGIN;

ALTER TABLE print_jobs
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Backfill existing rows
UPDATE print_jobs
SET updated_at = COALESCE(completed_at, created_at)
WHERE updated_at = NOW();

-- Generic trigger function (idempotent via OR REPLACE)
CREATE OR REPLACE FUNCTION trg_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS print_jobs_updated_at ON print_jobs;
CREATE TRIGGER print_jobs_updated_at
  BEFORE UPDATE ON print_jobs
  FOR EACH ROW
  EXECUTE FUNCTION trg_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_print_jobs_updated_at
  ON print_jobs(updated_at DESC);

COMMIT;
