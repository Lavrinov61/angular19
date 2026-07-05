-- Migration: print_jobs_batch_index
-- Add index on batch_id for efficient batch lookups
-- Idempotent: IF NOT EXISTS

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_print_jobs_batch_id ON print_jobs(batch_id) WHERE batch_id IS NOT NULL;
