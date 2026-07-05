-- Print job priority (0=normal, 4-6=elevated, 7-8=urgent, 9-10=critical/POS)
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 10);
CREATE INDEX IF NOT EXISTS idx_print_jobs_priority ON print_jobs(priority DESC, created_at) WHERE status = 'queued';
COMMENT ON COLUMN print_jobs.priority IS '0=normal, 4-6=elevated, 7-8=urgent, 9-10=critical (POS)';
