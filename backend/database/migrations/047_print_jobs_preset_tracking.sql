-- Migration 047: Link print_jobs to presets and face_validations + trace_id
-- Enables: preset audit trail, face validation linking, end-to-end request tracing
-- Idempotent: safe to re-run

-- 1. preset_id — which preset was used for this job
DO $$ BEGIN
  ALTER TABLE print_jobs ADD COLUMN preset_id UUID;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE print_jobs ADD CONSTRAINT print_jobs_preset_id_fkey
    FOREIGN KEY (preset_id) REFERENCES print_presets(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. face_validation_id — link to face validation result (for document photos)
DO $$ BEGIN
  ALTER TABLE print_jobs ADD COLUMN face_validation_id UUID;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE print_jobs ADD CONSTRAINT print_jobs_face_validation_id_fkey
    FOREIGN KEY (face_validation_id) REFERENCES face_validations(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. trace_id — end-to-end request correlation (X-Request-Id from Express)
DO $$ BEGIN
  ALTER TABLE print_jobs ADD COLUMN trace_id VARCHAR(64);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Indexes for querying
CREATE INDEX IF NOT EXISTS idx_print_jobs_preset_id ON print_jobs(preset_id) WHERE preset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_print_jobs_face_validation_id ON print_jobs(face_validation_id) WHERE face_validation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_print_jobs_trace_id ON print_jobs(trace_id) WHERE trace_id IS NOT NULL;
