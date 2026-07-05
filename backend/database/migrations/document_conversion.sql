-- Document Conversion Pipeline
-- Adds server-side PDF/DOCX/XLSX → JPEG conversion support to print system
-- Idempotent: safe to re-run

-- 1. Add 'converting' status to print_jobs
ALTER TABLE print_jobs DROP CONSTRAINT IF EXISTS print_jobs_status_check;
ALTER TABLE print_jobs ADD CONSTRAINT print_jobs_status_check
  CHECK (status IN (
    'queued','sending','applying_icc','rendering_layout',
    'printing','completed','failed','cancelled',
    'converting'
  ));

-- 2. New columns on print_jobs for document conversion
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS source_file_url TEXT;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS source_file_type VARCHAR(10);
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS parent_job_id UUID REFERENCES print_jobs(id) ON DELETE CASCADE;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS page_number INT;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS conversion_dpi INT DEFAULT 300;

-- 3. Index for parent→child lookup
CREATE INDEX IF NOT EXISTS idx_print_jobs_parent
  ON print_jobs(parent_job_id) WHERE parent_job_id IS NOT NULL;

-- 4. Conversion tasks queue
CREATE TABLE IF NOT EXISTS conversion_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES print_jobs(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  source_type VARCHAR(10) NOT NULL CHECK (source_type IN ('pdf','docx','xlsx','doc','xls')),
  pages INT[],
  dpi INT NOT NULL DEFAULT 300,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','downloading','converting_to_pdf','rendering','uploading','completed','failed')),
  error_message TEXT,
  total_pages INT,
  converted_pages INT DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversion_tasks_pending
  ON conversion_tasks(status, created_at) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_conversion_tasks_job
  ON conversion_tasks(job_id);

-- 5. Notify trigger for conversion tasks (same pattern as print_jobs)
CREATE OR REPLACE FUNCTION notify_conversion_task_new() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('conversion_tasks_new', json_build_object(
    'id', NEW.id,
    'job_id', NEW.job_id,
    'source_type', NEW.source_type
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_conversion_tasks_new ON conversion_tasks;
CREATE TRIGGER trg_conversion_tasks_new
  AFTER INSERT ON conversion_tasks
  FOR EACH ROW
  WHEN (NEW.status = 'pending')
  EXECUTE FUNCTION notify_conversion_task_new();

-- 6. Make printer_id nullable on print_jobs (parent conversion jobs don't have a printer yet)
ALTER TABLE print_jobs ALTER COLUMN printer_id DROP NOT NULL;
