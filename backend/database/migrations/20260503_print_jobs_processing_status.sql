-- Allow direct CUPS printing to expose the image-processing stage.
BEGIN;

ALTER TABLE print_jobs DROP CONSTRAINT IF EXISTS print_jobs_status_check;

ALTER TABLE print_jobs ADD CONSTRAINT print_jobs_status_check
  CHECK (status IN (
    'queued',
    'sending',
    'processing',
    'applying_icc',
    'rendering_layout',
    'printing',
    'completed',
    'failed',
    'cancelled',
    'converting',
    'paused',
    'held',
    'scheduled',
    'splitting',
    'finishing'
  ));

COMMIT;
